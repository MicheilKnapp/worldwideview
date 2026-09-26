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

A full planet basemap at z0–15 is roughly **120 GB**, and each zoom level
roughly doubles the size, so worldwide street detail is not affordable. Instead
several archives are configured with different coverage and maximum zoom.

The suggested shape for a 50 GB budget, most detailed first:

| Archive | Coverage | Max zoom | Purpose |
|---|---|---|---|
| `us.pmtiles` | United States | 14 | Street names |
| `na.pmtiles` | Canada and Mexico | 12 | Major roads, towns |
| `world.pmtiles` | Planet | 9 | Cities and towns only |

z14 rather than z15 for the top tier is deliberate: street labels only render
below 4 km camera height, where z14 already carries residential roads, and z15
would roughly double the file for detail no label uses.

**These numbers are a starting point, not a measurement.** Build the smallest
tier first, check its size, and adjust `--maxzoom` before committing to the
largest.

## Building the archives

Uses the [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli) (a single Go
binary) against a planet basemap file.

```bash
# Bounds are min-lon,min-lat,max-lon,max-lat
pmtiles extract PLANET.pmtiles world.pmtiles --maxzoom=9
pmtiles extract PLANET.pmtiles us.pmtiles    --maxzoom=14 --bbox=-125.0,24.4,-66.9,49.4
pmtiles extract PLANET.pmtiles na.pmtiles    --maxzoom=12 --bbox=-141.0,14.5,-52.6,70.0
```

`pmtiles extract` can read the planet file over HTTP, so the 120 GB source does
not need downloading in full — it fetches only the ranges each extract needs.

Overlap between tiers is expected and harmless: selection always prefers the
most detailed archive that covers a tile.

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
