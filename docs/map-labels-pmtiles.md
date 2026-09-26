# Map labels from PMTiles

Place and street labels read vector tiles from local [PMTiles](https://docs.protomaps.com/pmtiles/)
archives instead of querying Overpass. Overpass is shared volunteer
infrastructure that rate-limits and goes down; a local archive is a disk read
with no quota and no cold-fetch latency.

Overpass remains wired up as a fallback, so an instance with no archives
configured keeps working exactly as before.

## Why local files, not cloud storage

CORS does not apply. It is a browser mechanism, and tiles are decoded
server-side, so there is no cross-origin request to police — Protomaps'
documentation says the same: *"Server-side reading does not require CORS
configuration."*

That removes the usual reason to reach for object storage. A local file also
avoids per-request GET billing, egress cost and a second failure mode, and is
lower latency. Cloud storage only becomes the better answer if the **browser**
is ever given the archives directly, which is a different architecture.

Do **not** bake archives into the Docker image: a multi-gigabyte layer would be
rebuilt and shipped on every deploy. Put them on the existing `wwv-data` volume.

## Tiering

A full planet basemap at z0–15 is **138 GB** (measured against the 2026-09-25
build; the Protomaps docs still say ~120 GB). Each zoom level roughly doubles the
size, so worldwide street detail is not affordable. Instead several archives are
configured with different coverage and maximum zoom.

Sizes below are measured with `--dry-run`, not estimated:

| Archive | Coverage | Max zoom | Size |
|---|---|---|---|
| `us.pmtiles` | United States, incl. Alaska, Hawaii, Puerto Rico | 14 | 9.7 GB |
| `na.pmtiles` | Canada and Mexico | 13 | 8.1 GB |
| `world.pmtiles` | Planet | 10 | 3.8 GB |
| | | **total** | **21.6 GB** |

That leaves headroom inside a 50 GB budget for a re-cut, which briefly needs
space for both the old archive and the new `.partial` beside it.

`fetchPlacesFromTiles` defaults to `maxZoom = 10`, so a world archive capped at
z9 would serve every place request a coarser parent tile.

What each zoom buys for **streets** was measured against real tiles rather than
assumed, by counting named ways whose class appears in `LABELLED_HIGHWAYS`
(downtown San Francisco, one tile):

| z10 | z11 | z12 | z13 | z14 |
|---|---|---|---|---|
| 0 | 12, all motorway | 121, primary + secondary | 147, adds tertiary | 152, adds residential |

Two consequences. The `world` tier at z10 gives place names everywhere but
**street names nowhere** outside the `us` and `na` tiers; global street labels
mean `world` at z12, which measures 18 GB against 3.8 GB at z10. And the `us`
tier stops at z14 because that is where residential streets arrive — z15
measures 19 GB for the US alone, doubling the file for geometry that
`simplifyPolyline` then discards.

Zooms are overridable per tier without editing the script:

```bash
WORLD_MAXZOOM=12 scripts/build-pmtiles.sh estimate world
```

The US tier is cut from a **GeoJSON region, not a bbox**: a single rectangle
around the United States either omits Alaska, Hawaii and Puerto Rico, or
swallows most of Canada and the Pacific. See `scripts/pmtiles-us-region.geojson`.
Including the three of them costs only +0.9 GB over the contiguous states.

## Building the archives

`scripts/build-pmtiles.sh` does the whole job — it fetches the
[PMTiles CLI](https://docs.protomaps.com/pmtiles/cli), finds the newest planet
build and cuts each tier. Run it where the files will live.

```bash
scripts/build-pmtiles.sh estimate   # sizes only, no download
scripts/build-pmtiles.sh            # build all tiers, cheapest first
scripts/build-pmtiles.sh world      # one tier
```

**Run `estimate` first after changing any zoom or bound.**
`pmtiles extract --dry-run` walks the source archive's tile directory and reports
the exact resulting size without downloading any tiles — seconds per tier, a
handful of HTTP requests. A maxzoom that busts the disk budget is far cheaper to
find this way than hours into a download.

The equivalent by hand:

```bash
pmtiles extract PLANET.pmtiles world.pmtiles --maxzoom=10
pmtiles extract PLANET.pmtiles na.pmtiles    --maxzoom=13 --bbox=-141.0,14.5,-52.6,70.0
pmtiles extract PLANET.pmtiles us.pmtiles    --maxzoom=14 --region=scripts/pmtiles-us-region.geojson
```

`pmtiles extract` reads the planet over HTTP range requests, so the 138 GB
source is never downloaded in full — only the ranges each extract needs. The
`world` tier, for instance, is cut in five requests.

Two things about the source. Builds live at
`https://build.protomaps.com/YYYYMMDD.pmtiles`, there is no bucket listing, and
they are retained only about a fortnight — so a pinned date stops working, and
the script probes backwards for the newest instead. The CDN also throttles:
bursts get HTTP 503, including on the 127-byte header read every extract opens
with, which looks exactly like a missing archive. The script retries with
backoff; by hand, just try again.

Overlap between tiers is expected and harmless: selection always prefers the
most detailed archive that has the tile.

## Verifying an archive

```bash
PMTILES_ARCHIVES=/app/data/pmtiles/us.pmtiles   node node_modules/tsx/dist/cli.mjs scripts/verify-pmtiles.ts
```

Runs the real pipeline over a real archive and prints which layers a tile
contains, every `kind` / `kind_detail` seen, and what survives
`selectVisiblePlaces` and `selectStreetLabels`. Unit tests use synthetic tiles
and so cannot catch the things most likely to break here — whether Protomaps
still names its layers `places` and `roads`, and whether its kind values still
match `LABELLED_KINDS` and `LABELLED_HIGHWAYS`. Worth running against a small
test extract before building the large tiers.

## Configuration

```
PMTILES_ARCHIVES=/app/data/pmtiles/us.pmtiles,/app/data/pmtiles/na.pmtiles,/app/data/pmtiles/world.pmtiles
```

**Order matters — most detailed first.** Selection walks the list and takes the
first archive whose own header covers the requested tile and zoom.

Coverage is read from each file's header, never hardcoded. Re-cutting an extract
with different bounds therefore needs no code change.

Leave the variable unset to disable the source; the routes fall back to Overpass.

HTTP(S) entries are also accepted and read with range requests, which is useful
for trying an archive before copying it to the volume.

## How a request resolves

1. A view arrives at `/api/map-labels` or `/api/map-labels/streets` as a bbox.
2. The bbox is snapped to the existing fixed cache grid (unchanged).
3. For each grid tile: Redis, then PMTiles, then Overpass.
4. PMTiles picks a zoom for the tile, reads from the best covering archive,
   decodes the `places` or `roads` layer, and maps features onto `PlaceLabel` /
   `StreetWay`.
5. Everything downstream is untouched — `selectVisiblePlaces`,
   `selectStreetLabels`, `clipToView`, `anchorsAlong`, `simplifyPolyline`,
   `textTexture` and the billboard rotation.

When only a coarse archive covers an area, the read retries at progressively
lower zooms, so such a view still gets labels — fewer of them — rather than none.

An archive's header states a **bounding box**, which is always looser than the
tiles it holds: the US region's bounds reach into Canada, Mexico and the Pacific
without containing a tile there. So an empty answer from a covering archive is
not authoritative, and every remaining archive is still asked. Skipping that
would let the most detailed tier shadow all the coarser ones across the slack in
its own bounds — Canadian street labels would silently return nothing. Only once
every covering archive agrees a tile is empty does the read stop, which keeps
open ocean from walking all the way down to z0.

## Schema notes

Protomaps describes features with `kind` / `kind_detail` rather than raw OSM
tags. `kind_detail` is preferred when mapping, because `kind` is broader: a city
and a village are both `locality`.

`population_rank` is a precomputed significance ordering that raw OSM does not
provide. Where a place has no `population`, the rank is scaled into the same
numeric space so the existing comparison keeps working.

## Licensing

Protomaps basemaps are OpenStreetMap derivatives under the
[ODbL](https://opendatacommons.org/licenses/odbl/1-0/) — the same terms already
stated on the Privacy Policy and Terms pages. Attribution requirements are
unchanged.
