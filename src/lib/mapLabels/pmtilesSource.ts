import { FetchSource, PMTiles, type Header } from "pmtiles";

import { NodeFileSource } from "./nodeFileSource";

/**
 * Reads vector tiles from local PMTiles archives.
 *
 * Replaces Overpass as the label data source. Overpass is a shared volunteer
 * service that rate-limits and goes down; a PMTiles archive on disk is a local
 * read with no quota, no cold-fetch latency and no circuit breaker.
 *
 * ARCHIVES ARE TIERED, not one file. A planet basemap at full detail is ~138GB,
 * and each zoom level roughly doubles size, so covering the world at street
 * detail is not affordable. Instead several archives are configured, each with
 * its own coverage and maximum zoom — for example the United States at street
 * detail, its neighbours at a coarser level, and the whole world coarser again.
 *
 * Selection is driven by each archive's OWN header, never by hardcoded country
 * bounds. Every PMTiles file states its geographic extent and min/max zoom, so
 * the best archive for a tile can be derived from the files actually present.
 * Re-cutting an extract with different bounds therefore needs no code change.
 *
 * Configured through PMTILES_ARCHIVES: a comma-separated list of paths or URLs,
 * most detailed first. Empty or unset disables the source entirely, so an
 * instance without the files keeps working on whatever fallback the caller has.
 */

export interface TileCoord {
    z: number;
    x: number;
    y: number;
}

interface Archive {
    /** Path or URL as configured, for logging. */
    readonly name: string;
    readonly tiles: PMTiles;
    header: Header | null;
}

let archives: Archive[] | null = null;

function configuredLocations(): string[] {
    const raw = process.env.PMTILES_ARCHIVES?.trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Opens the configured archives once per process.
 *
 * A URL gets a FetchSource, which PMTiles serves with HTTP range requests; a
 * bare path gets a FileSource. Both are read server-side, so no CORS applies
 * either way — that is a browser mechanism.
 */
function openArchives(): Archive[] {
    if (archives) return archives;

    archives = configuredLocations().map((location) => {
        const isUrl = location.startsWith("http://") || location.startsWith("https://");
        // NodeFileSource, not the library's FileSource: that one takes a
        // browser File object and fails at runtime given a path.
        const source = isUrl ? new FetchSource(location) : new NodeFileSource(location);
        return { name: location, tiles: new PMTiles(source), header: null };
    });

    if (archives.length === 0) {
        console.log("[pmtiles] PMTILES_ARCHIVES not set — vector tile source disabled");
    } else {
        console.log(`[pmtiles] ${archives.length} archive(s) configured`);
    }
    return archives;
}

export function isPmtilesConfigured(): boolean {
    return openArchives().length > 0;
}

/** Header, read once and kept. Failures are logged and the archive skipped. */
async function headerFor(archive: Archive): Promise<Header | null> {
    if (archive.header) return archive.header;
    try {
        archive.header = await archive.tiles.getHeader();
        return archive.header;
    } catch (err) {
        console.error(
            `[pmtiles] cannot read header for ${archive.name}:`,
            err instanceof Error ? err.message : err,
        );
        return null;
    }
}

/** Converts a tile's x/y at zoom z into its lon/lat bounds. */
export function tileBounds(coord: TileCoord): {
    west: number;
    south: number;
    east: number;
    north: number;
} {
    const n = 2 ** coord.z;
    const lonAt = (x: number) => (x / n) * 360 - 180;
    const latAt = (y: number) => {
        const r = Math.PI - (2 * Math.PI * y) / n;
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r)));
    };
    return {
        west: lonAt(coord.x),
        east: lonAt(coord.x + 1),
        // Tile Y increases southward, so y+1 is the SOUTH edge.
        north: latAt(coord.y),
        south: latAt(coord.y + 1),
    };
}

function headerCoversTile(header: Header, coord: TileCoord): boolean {
    if (coord.z < header.minZoom || coord.z > header.maxZoom) return false;
    const b = tileBounds(coord);
    // Reject only a genuine miss: touching the edge still counts as covered.
    if (b.east < header.minLon || b.west > header.maxLon) return false;
    if (b.north < header.minLat || b.south > header.maxLat) return false;
    return true;
}

export interface TileResult {
    data: ArrayBuffer;
    /** Which archive answered, and at which zoom. */
    archive: string;
    z: number;
}

/**
 * Fetches one tile from the most detailed archive that covers it.
 *
 * When no archive holds the requested zoom, the request is retried at
 * progressively coarser zooms down to `minZoom`. A view over an area only
 * covered by a low-detail archive therefore still gets labels, just fewer of
 * them, rather than nothing at all.
 */
export async function getVectorTile(
    coord: TileCoord,
    minZoom = 0,
): Promise<TileResult | null> {
    const open = openArchives();
    if (open.length === 0) return null;

    for (let z = coord.z; z >= minZoom; z--) {
        const shift = coord.z - z;
        const at: TileCoord = {
            z,
            x: Math.floor(coord.x / 2 ** shift),
            y: Math.floor(coord.y / 2 ** shift),
        };

        // Archives are configured most detailed first, so the first match wins.
        // A header only states an archive's bounding box, which is coarser than
        // the data it holds: a US extract's bbox reaches into Canada and Mexico
        // without containing a single tile there. So an empty answer from a
        // covering archive is NOT authoritative — the next archive must still be
        // asked, or a detailed tier would shadow every coarser one across the
        // slack in its own bounds.
        let answered = false;
        for (const archive of open) {
            const header = await headerFor(archive);
            if (!header || !headerCoversTile(header, at)) continue;
            try {
                const result = await archive.tiles.getZxy(at.z, at.x, at.y);
                if (result?.data) {
                    return { data: result.data, archive: archive.name, z: at.z };
                }
                // Read cleanly, genuinely no tile here.
                answered = true;
            } catch (err) {
                // A failed read says nothing about coverage, so it must not
                // count as an answer.
                console.error(
                    `[pmtiles] ${archive.name} failed at ${at.z}/${at.x}/${at.y}:`,
                    err instanceof Error ? err.message : err,
                );
            }
        }

        // Every archive that covers this tile agreed it is empty — ocean, or
        // desert. Retrying at a coarser zoom would only widen the area and find
        // the same nothing, so stop here rather than walking down to z0.
        if (answered) return null;
    }
    return null;
}

/** Test seam: forces archives to be reopened on the next call. */
export function resetPmtilesSource(): void {
    archives = null;
}
