import { decodePlaces, decodeStreets } from "./decodeTile";
import { getVectorTile, isPmtilesConfigured, type TileCoord } from "./pmtilesSource";
import type { PlaceLabel } from "./places";
import type { StreetWay } from "./streets";
import type { Bbox } from "./tiles";

/**
 * Label data read from local PMTiles archives.
 *
 * Drop-in replacements for fetchPlaces and fetchStreets, returning the same
 * types so nothing downstream changes. The difference is upstream: a local disk
 * read with no quota, no rate limit and no cold-fetch latency, instead of a
 * shared volunteer service that throttles.
 */

/** Slippy tile x/y for a lon/lat at a zoom. */
function tileForLonLat(lon: number, lat: number, z: number): { x: number; y: number } {
    const n = 2 ** z;
    const clampedLat = Math.max(Math.min(lat, 85.0511), -85.0511);
    const latRad = (clampedLat * Math.PI) / 180;
    return {
        x: Math.floor(((lon + 180) / 360) * n),
        y: Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
        ),
    };
}

/**
 * Every tile covering a bbox at a zoom, capped.
 *
 * The cap matters because a wide bbox at a high zoom covers thousands of tiles.
 * Callers choose the zoom so the count stays small; the cap is a backstop
 * against a pathological view rather than the normal path.
 */
export function tilesCovering(bbox: Bbox, z: number, maxTiles = 12): TileCoord[] {
    const topLeft = tileForLonLat(bbox.west, bbox.north, z);
    const bottomRight = tileForLonLat(bbox.east, bbox.south, z);

    const coords: TileCoord[] = [];
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
        for (let x = topLeft.x; x <= bottomRight.x; x++) {
            coords.push({ z, x, y });
            if (coords.length >= maxTiles) return coords;
        }
    }
    return coords;
}

/**
 * Chooses a tile zoom for a bbox.
 *
 * Picks the highest zoom whose tiles still cover the view in a handful of
 * requests. Vector tiles are generalised per zoom — minor roads simply are not
 * present at low zoom — so the zoom decides how much detail exists at all, not
 * merely how many tiles are read.
 */
export function zoomForBbox(bbox: Bbox, maxZoom: number, maxTiles = 4): number {
    const width = Math.abs(bbox.east - bbox.west);
    const height = Math.abs(bbox.north - bbox.south);
    const span = Math.max(width, height, 1e-9);

    // A tile at zoom z spans 360/2^z degrees of longitude.
    for (let z = maxZoom; z >= 0; z--) {
        const tileSpan = 360 / 2 ** z;
        const across = Math.floor(span / tileSpan) + 1;
        if (across * across <= maxTiles) return z;
    }
    return 0;
}

export function tilesAvailable(): boolean {
    return isPmtilesConfigured();
}

/** Place labels for a bbox, or null when no archive is configured. */
export async function fetchPlacesFromTiles(
    bbox: Bbox,
    maxZoom = 10,
): Promise<PlaceLabel[] | null> {
    if (!isPmtilesConfigured()) return null;

    const z = zoomForBbox(bbox, maxZoom);
    const coords = tilesCovering(bbox, z);

    // In parallel: these are local reads, and a view spans several tiles.
    const results = await Promise.all(
        coords.map(async (coord) => {
            const tile = await getVectorTile(coord);
            if (!tile) return [];
            try {
                // Decode against the zoom that ANSWERED, which may be coarser
                // than requested when only a low-detail archive covers the area.
                return decodePlaces(tile.data, { ...coord, z: tile.z });
            } catch (err) {
                console.error(
                    "[pmtiles] place decode failed:",
                    err instanceof Error ? err.message : err,
                );
                return [];
            }
        }),
    );

    const seen = new Set<string>();
    const places: PlaceLabel[] = [];
    for (const batch of results) {
        for (const place of batch) {
            // Places straddling a tile edge appear in both tiles.
            if (seen.has(place.id)) continue;
            seen.add(place.id);
            places.push(place);
        }
    }
    return places;
}

/** Named roads for a bbox, or null when no archive is configured. */
export async function fetchStreetsFromTiles(
    bbox: Bbox,
    maxZoom = 15,
): Promise<StreetWay[] | null> {
    if (!isPmtilesConfigured()) return null;

    const z = zoomForBbox(bbox, maxZoom);
    const coords = tilesCovering(bbox, z);

    const results = await Promise.all(
        coords.map(async (coord) => {
            const tile = await getVectorTile(coord);
            if (!tile) return [];
            try {
                return decodeStreets(tile.data, { ...coord, z: tile.z });
            } catch (err) {
                console.error(
                    "[pmtiles] street decode failed:",
                    err instanceof Error ? err.message : err,
                );
                return [];
            }
        }),
    );

    // No dedupe by id here: road ids are tile-scoped by construction, and a
    // street crossing a tile boundary genuinely arrives as two pieces. Grouping
    // by name in selectStreetLabels stitches it back together.
    return results.flat();
}
