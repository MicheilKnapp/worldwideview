/**
 * Place labels drawn over the globe.
 *
 * Google Photorealistic 3D Tiles carry no place names, and an imagery layer
 * cannot supply them: imagery paints the globe surface, which the tileset sits
 * on top of and hides. Labels therefore have to be Cesium Label primitives
 * drawn with depth testing disabled, the same way entity labels already stay
 * above terrain and buildings.
 *
 * This module holds the parts that are pure — what counts as a place, how to
 * rank one, and how to thin a crowd of them — so they are testable without a
 * globe.
 */

/** OSM place values worth labelling. */
export type PlaceKind =
    | "city"
    | "borough"
    | "town"
    | "suburb"
    | "village"
    | "quarter"
    | "neighbourhood"
    | "hamlet";

export interface PlaceLabel {
    id: string;
    name: string;
    lat: number;
    lon: number;
    kind: PlaceKind;
    /** OSM population where tagged; breaks ties between equal kinds. */
    population: number;
}

/** Lower is more important, so a city survives where a neighbourhood does not. */
const KIND_RANK: Record<PlaceKind, number> = {
    city: 0,
    borough: 1,
    town: 2,
    suburb: 3,
    village: 4,
    quarter: 5,
    neighbourhood: 6,
    hamlet: 7,
};

export const LABELLED_KINDS = Object.keys(KIND_RANK) as PlaceKind[];

export function placeRank(place: PlaceLabel): number {
    return KIND_RANK[place.kind] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Least important place kind worth showing at a given camera height, in metres
 * above the ellipsoid.
 *
 * Neighbourhoods from orbit are unreadable soup; only cities at street level
 * leaves the view unlabelled.
 */
export function minimumRankForHeight(cameraHeightM: number): number {
    if (cameraHeightM > 600_000) return KIND_RANK.city;
    if (cameraHeightM > 250_000) return KIND_RANK.town;
    if (cameraHeightM > 80_000) return KIND_RANK.village;
    if (cameraHeightM > 25_000) return KIND_RANK.suburb;
    return KIND_RANK.hamlet;
}

/**
 * Minimum separation between two labels, in degrees, for a camera height.
 *
 * Cesium has no label collision handling, so without thinning every name in
 * view is drawn and they overlap into illegibility. Separating geographically
 * rather than in screen space keeps this cheap and frame-rate independent — an
 * approximation of decluttering, but a stable one that does not flicker as the
 * camera moves.
 */
export function minSeparationDegrees(cameraHeightM: number): number {
    if (cameraHeightM > 600_000) return 2.0;
    if (cameraHeightM > 250_000) return 0.8;
    if (cameraHeightM > 80_000) return 0.25;
    if (cameraHeightM > 25_000) return 0.08;
    return 0.02;
}

/**
 * Thins labels so no two sit closer than the minimum separation, keeping the
 * most significant of any cluster.
 *
 * @param places Candidates, any order.
 * @param cameraHeightM Camera height, which sets both the cut-off and spacing.
 * @param limit Hard ceiling on labels drawn at once.
 */
export function selectVisiblePlaces(
    places: PlaceLabel[],
    cameraHeightM: number,
    limit = 120,
): PlaceLabel[] {
    const maxRank = minimumRankForHeight(cameraHeightM);
    const minGap = minSeparationDegrees(cameraHeightM);

    // Most important first, so the survivor of any cluster is the one that
    // matters. Population breaks ties within a kind.
    const ranked = places
        .filter((p) => placeRank(p) <= maxRank)
        .sort((a, b) => placeRank(a) - placeRank(b) || b.population - a.population);

    const kept: PlaceLabel[] = [];
    for (const place of ranked) {
        if (kept.length >= limit) break;
        const clashes = kept.some(
            (k) => Math.abs(k.lat - place.lat) < minGap && Math.abs(k.lon - place.lon) < minGap,
        );
        if (!clashes) kept.push(place);
    }
    return kept;
}
