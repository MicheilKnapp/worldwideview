import { overpassMirrors, requestMirror } from "@/lib/surveillance/overpass";

import { LABELLED_HIGHWAYS, type HighwayClass, type StreetWay } from "./streets";
import { simplifyPolyline } from "./simplify";
import type { Bbox } from "./tiles";

/**
 * Fetches named road geometry for a bounding box.
 *
 * Far heavier than place nodes: `out geom` returns every coordinate of every
 * way, so this is only ever called for small tiles at close zoom, and the
 * result is cached hard. The bounding box leads the query — putting a tag
 * filter first makes Overpass evaluate it before narrowing spatially, which
 * timed out every mirror when the place query was written that way.
 */

/** Overpass server-side budget. */
const TIMEOUT_SEC = 30;
/** Client-side ceiling. A user-facing request must not hang. */
const REQUEST_TIMEOUT_MS = 35_000;
/** Ceiling on ways per tile; thinning then happens per zoom on the client. */
const MAX_ELEMENTS = 1_200;

export function buildStreetsQuery(bbox: Bbox): string {
    const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    // `out geom` gives each way's coordinates inline, which is what the label
    // placement needs. Without it the ways come back as node ID references and
    // would need a second resolving query.
    return `[out:json][timeout:${TIMEOUT_SEC}];
way(${box})["highway"]["name"];
out geom ${MAX_ELEMENTS};`;
}

interface OverpassWay {
    type: string;
    id: number;
    tags?: Record<string, string>;
    geometry?: { lat: number; lon: number }[];
}

function toStreet(el: OverpassWay): StreetWay | null {
    const name = el.tags?.name;
    const kind = el.tags?.highway as HighwayClass | undefined;
    if (!name || !kind || !LABELLED_HIGHWAYS.includes(kind)) return null;

    const geometry = el.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) return null;

    const raw = geometry
        .filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
        .map((g): [number, number] => [g.lon, g.lat]);
    if (raw.length < 2) return null;

    // Simplified before caching, not after: OSM's full vertex detail is far more
    // than a label needs, and carrying it inflates the payload, the parse cost
    // and the cache entry for no visible gain.
    const coords = simplifyPolyline(raw);

    return { id: `w${el.id}`, name, kind, coords };
}

export async function fetchStreets(bbox: Bbox): Promise<StreetWay[]> {
    const query = buildStreetsQuery(bbox);
    const failures: string[] = [];

    for (const mirror of overpassMirrors()) {
        try {
            const elements = (await requestMirror(
                mirror,
                query,
                REQUEST_TIMEOUT_MS,
            )) as unknown as OverpassWay[];
            return elements.map(toStreet).filter((w): w is StreetWay => w !== null);
        } catch (err) {
            failures.push(`${new URL(mirror).host}: ${err instanceof Error ? err.message : err}`);
        }
    }
    throw new Error(`all Overpass mirrors failed for street labels — ${failures.join("; ")}`);
}
