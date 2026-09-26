import { overpassMirrors, requestMirror } from "@/lib/surveillance/overpass";

import { LABELLED_KINDS, type PlaceKind, type PlaceLabel } from "./places";

/**
 * Fetches place names for a bounding box from Overpass.
 *
 * Reuses the surveillance layer's mirror handling rather than re-implementing
 * it: those guards exist because a busy instance answers 200 with an HTML body
 * and a stale mirror answers 200 with months-old data.
 */

/** Overpass server-side budget. Place queries over one view are small. */
const TIMEOUT_SEC = 25;

/** Ceiling on what Overpass returns; thinning happens client-side per zoom. */
const MAX_ELEMENTS = 800;

export interface Bbox {
    south: number;
    west: number;
    north: number;
    east: number;
}

export function buildPlacesQuery(bbox: Bbox): string {
    const kinds = LABELLED_KINDS.join("|");
    const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
    // Nodes only: place polygons would need centroids, and OSM tags a labelling
    // node for populated places anyway.
    return `[out:json][timeout:${TIMEOUT_SEC}];
node["place"~"^(${kinds})$"]["name"](${box});
out body ${MAX_ELEMENTS};`;
}

function toPlace(el: {
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
}): PlaceLabel | null {
    const { lat, lon, tags } = el;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    const name = tags?.name;
    const kind = tags?.place as PlaceKind | undefined;
    if (!name || !kind || !LABELLED_KINDS.includes(kind)) return null;

    // Population is frequently absent, and sometimes carries separators.
    const population = Number.parseInt((tags?.population ?? "").replace(/[^\d]/g, ""), 10);

    return {
        id: `n${el.id}`,
        name,
        lat,
        lon,
        kind,
        population: Number.isFinite(population) ? population : 0,
    };
}

export async function fetchPlaces(bbox: Bbox): Promise<PlaceLabel[]> {
    const query = buildPlacesQuery(bbox);
    const failures: string[] = [];

    for (const mirror of overpassMirrors()) {
        try {
            const elements = await requestMirror(mirror, query);
            return elements
                .map(toPlace)
                .filter((p): p is PlaceLabel => p !== null);
        } catch (err) {
            failures.push(`${new URL(mirror).host}: ${err instanceof Error ? err.message : err}`);
        }
    }
    throw new Error(`all Overpass mirrors failed for place labels — ${failures.join("; ")}`);
}
