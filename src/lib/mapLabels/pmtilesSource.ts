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
    /** Which archive answered. */
    archive: string;
    /**
     * The tile that was actually served, which is often a coarser ancestor of
     * the one requested.
     *
     * All three of z, x and y must travel together. A vector tile's geometry is
     * relative to its own tile, so decoding needs the coordinates of the tile
     * the bytes came from; pairing the served zoom with the requested x/y puts
     * every feature thousands of degrees away.
     */
    coord: TileCoord;
}

/**
 * Fetches one tile from the most detailed archive that has it.
 *
 * Each archive is asked at ITS OWN maximum zoom, not at the requested one. A
 * tiered set holds the same ground at different detail, so a request for z15
 * means "the best available detail here", which is z14 from a street-level
 * archive and z12 from a planet-wide one. Asking every archive about z15 and
 * then walking the whole set down one zoom at a time conflates two different
 * questions and gets the answer wrong.
 *
 * Concretely, it broke Europe. A header states one bounding box, and a United
 * States region cut with a polygon for the western Aleutians spans from -180 to
 * 180 in longitude, because Alaska and the Aleutians sit either side of the
 * antimeridian. So us.pmtiles claims to cover Paris. Descending globally, the
 * search reached z14, found that claim, got no tile, concluded the ground was
 * empty and stopped — never reaching z12, where the world archive has the data.
 *
 * An empty answer is therefore never authoritative: a header's box is always
 * looser than the tiles behind it. Only after every archive has been asked, each
 * at the zoom it can actually serve, is a tile treated as absent.
 */
export async function getVectorTile(
    coord: TileCoord,
    minZoom = 0,
): Promise<TileResult | null> {
    const open = openArchives();
    if (open.length === 0) return null;

    // Configured most detailed first, so the first archive with data wins.
    for (const archive of open) {
        const header = await headerFor(archive);
        if (!header) continue;

        // Never above what this archive holds, never above what was asked for.
        const z = Math.min(coord.z, header.maxZoom);
        if (z < minZoom || z < header.minZoom) continue;

        const shift = coord.z - z;
        const at: TileCoord = {
            z,
            x: Math.floor(coord.x / 2 ** shift),
            y: Math.floor(coord.y / 2 ** shift),
        };
        if (!headerCoversTile(header, at)) continue;

        try {
            const result = await archive.tiles.getZxy(at.z, at.x, at.y);
            if (result?.data) {
                return { data: result.data, archive: archive.name, coord: at };
            }
            // Covered by the box but no tile here: this archive does not hold
            // this ground. Ask the next one.
        } catch (err) {
            console.error(
                `[pmtiles] ${archive.name} failed at ${at.z}/${at.x}/${at.y}:`,
                err instanceof Error ? err.message : err,
            );
        }
    }
    return null;
}

/** Test seam: forces archives to be reopened on the next call. */
export function resetPmtilesSource(): void {
    archives = null;
}
