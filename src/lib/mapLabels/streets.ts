/**
 * Street-name labels.
 *
 * Harder than place names for three reasons, all addressed here.
 *
 * 1. A street is a line, not a point, so a single label at its centroid reads as
 *    wrong on anything longer than a block. Names are placed at intervals ALONG
 *    the way instead.
 * 2. The text has to follow the road's direction on screen, and screen direction
 *    depends on where the camera is. So each anchor carries a second point a
 *    little further along the way; the renderer projects both and derives the
 *    on-screen angle, which stays correct as the camera rotates and tilts.
 *    Baking a geographic bearing here would be wrong the moment the view is not
 *    north-up.
 * 3. There are vastly more roads than places, so both which roads qualify and
 *    how many labels survive are driven by zoom.
 *
 * Everything in this module is pure so it can be tested without a globe or a
 * network.
 */

/** OSM highway values worth labelling, most significant first. */
export type HighwayClass =
    | "motorway"
    | "trunk"
    | "primary"
    | "secondary"
    | "tertiary"
    | "residential"
    | "unclassified"
    | "living_street"
    | "pedestrian";

const CLASS_RANK: Record<HighwayClass, number> = {
    motorway: 0,
    trunk: 1,
    primary: 2,
    secondary: 3,
    tertiary: 4,
    residential: 5,
    unclassified: 6,
    living_street: 7,
    pedestrian: 8,
};

export const LABELLED_HIGHWAYS = Object.keys(CLASS_RANK) as HighwayClass[];

/** A named way with its geometry, as returned by Overpass `out geom`. */
export interface StreetWay {
    id: string;
    name: string;
    kind: HighwayClass;
    /** [lon, lat] pairs in order along the way. */
    coords: [number, number][];
}

/** One placed label: where it sits, and which way it points. */
export interface StreetAnchor {
    id: string;
    /** The way this anchor came from. Anchors of one way are spaced by
     *  construction, so they must not suppress each other. */
    wayId: string;
    name: string;
    kind: HighwayClass;
    lat: number;
    lon: number;
    /** A point a short way further along, used to derive the screen angle. */
    aheadLat: number;
    aheadLon: number;
}

export function highwayRank(kind: HighwayClass): number {
    return CLASS_RANK[kind] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Street labels are only worth drawing close in. Above this camera height in
 * metres the roads are too dense and too small to read, and fetching their
 * geometry would be a lot of upstream work for nothing.
 */
export const MAX_STREET_LABEL_HEIGHT_M = 4_000;

/**
 * Least important road class worth labelling at a camera height.
 *
 * Residential streets only appear once genuinely close; from further out just
 * the arterials, which is what makes a city view legible rather than striped.
 */
export function minimumHighwayRankForHeight(cameraHeightM: number): number {
    if (cameraHeightM > 3_000) return CLASS_RANK.primary;
    if (cameraHeightM > 1_800) return CLASS_RANK.secondary;
    if (cameraHeightM > 900) return CLASS_RANK.tertiary;
    return CLASS_RANK.pedestrian;
}

/** Longitude degrees shrink with latitude; without this, spacing skews east-west. */
function lonScale(latDeg: number): number {
    return Math.cos((latDeg * Math.PI) / 180);
}

/** Approximate length of a segment in degrees, corrected for latitude. */
function segmentLengthDeg(
    [lon1, lat1]: [number, number],
    [lon2, lat2]: [number, number],
): number {
    const dLat = lat2 - lat1;
    const dLon = (lon2 - lon1) * lonScale((lat1 + lat2) / 2);
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function polylineLengthDeg(coords: [number, number][]): number {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
        total += segmentLengthDeg(coords[i - 1], coords[i]);
    }
    return total;
}

/** Label spacing along a road, in degrees, for a camera height. */
export function labelSpacingDegrees(cameraHeightM: number): number {
    if (cameraHeightM > 3_000) return 0.012;
    if (cameraHeightM > 1_800) return 0.006;
    if (cameraHeightM > 900) return 0.003;
    return 0.0015;
}

/**
 * Places anchors along a way at roughly even spacing.
 *
 * Anchors sit at segment interiors rather than at vertices: a vertex is usually
 * a corner, and text rotated to a corner's bearing looks misaligned against
 * both of the segments meeting there.
 *
 * @param way The road.
 * @param spacingDeg Target gap between labels.
 * @param maxPerWay Ceiling, so one long motorway cannot flood the view.
 */
export function anchorsAlong(
    way: StreetWay,
    spacingDeg: number,
    maxPerWay = 4,
): StreetAnchor[] {
    const { coords } = way;
    if (coords.length < 2) return [];

    const total = polylineLengthDeg(coords);
    // Too short to carry its own name at this zoom; it would collide with
    // whatever is next to it.
    if (total < spacingDeg * 0.5) return [];

    const count = Math.max(1, Math.min(maxPerWay, Math.round(total / spacingDeg)));
    const anchors: StreetAnchor[] = [];

    for (let n = 0; n < count; n++) {
        // Fractions at segment interiors: 1/(2c), 3/(2c), ... never at an end.
        const targetDist = ((2 * n + 1) / (2 * count)) * total;

        let walked = 0;
        for (let i = 1; i < coords.length; i++) {
            const segLen = segmentLengthDeg(coords[i - 1], coords[i]);
            if (segLen === 0) continue;
            if (walked + segLen < targetDist) {
                walked += segLen;
                continue;
            }
            const t = (targetDist - walked) / segLen;
            const [lon1, lat1] = coords[i - 1];
            const [lon2, lat2] = coords[i];
            anchors.push({
                id: `${way.id}:${n}`,
                wayId: way.id,
                name: way.name,
                kind: way.kind,
                lat: lat1 + (lat2 - lat1) * t,
                lon: lon1 + (lon2 - lon1) * t,
                // The segment's far end gives the direction. Using the segment
                // rather than a fixed offset keeps the angle right on curves.
                aheadLat: lat2,
                aheadLon: lon2,
            });
            break;
        }
    }
    return anchors;
}

/**
 * Chooses which street labels to draw.
 *
 * Thins by class first, then spacing, then repetition: the same street name
 * appearing three times within a block is noise, not information.
 */
export function selectStreetLabels(
    ways: StreetWay[],
    cameraHeightM: number,
    limit = 80,
): StreetAnchor[] {
    if (cameraHeightM > MAX_STREET_LABEL_HEIGHT_M) return [];

    const maxRank = minimumHighwayRankForHeight(cameraHeightM);
    const spacing = labelSpacingDegrees(cameraHeightM);

    const candidates = ways
        .filter((w) => highwayRank(w.kind) <= maxRank)
        .sort((a, b) => highwayRank(a.kind) - highwayRank(b.kind))
        .flatMap((w) => anchorsAlong(w, spacing));

    const kept: StreetAnchor[] = [];
    for (const anchor of candidates) {
        if (kept.length >= limit) break;
        const tooClose = kept.some((k) => {
            // Anchors from the same way are deliberately spaced along it by
            // anchorsAlong. Suppressing those would leave one name on a long
            // road, which is the problem this whole module exists to avoid.
            if (k.wayId === anchor.wayId) return false;

            const dLat = Math.abs(k.lat - anchor.lat);
            const dLon = Math.abs(k.lon - anchor.lon) * lonScale(anchor.lat);
            // The same name arriving from a DIFFERENT way is a street split
            // into segments, and needs far more room than a neighbouring
            // street's name does before it earns a second label.
            const gap = k.name === anchor.name ? spacing * 3 : spacing * 0.5;
            return dLat < gap && dLon < gap;
        });
        if (!tooClose) kept.push(anchor);
    }
    return kept;
}
