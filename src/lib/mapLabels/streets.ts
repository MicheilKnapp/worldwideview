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
    /**
     * Skip the minimum-length check. Set when the way is a fragment of a longer
     * named street: the fragment may be short, but the street is not, and
     * dropping it would leave a major road unlabelled.
     */
    allowShort = false,
): StreetAnchor[] {
    const { coords } = way;
    if (coords.length < 2) return [];

    const total = polylineLengthDeg(coords);
    // Too short to carry its own name at this zoom; it would collide with
    // whatever is next to it. Waived for fragments of a longer street.
    if (!allowShort && total < spacingDeg * 0.5) return [];

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

export interface ViewRect {
    west: number;
    south: number;
    east: number;
    north: number;
}

/** Fraction of the view size kept beyond its edges, so panning reveals labels
 *  that are already placed rather than popping them in. */
const VIEW_MARGIN = 0.25;

function padView(view: ViewRect): ViewRect {
    const padLon = Math.abs(view.east - view.west) * VIEW_MARGIN;
    const padLat = Math.abs(view.north - view.south) * VIEW_MARGIN;
    return {
        west: view.west - padLon,
        east: view.east + padLon,
        south: view.south - padLat,
        north: view.north + padLat,
    };
}

/**
 * Clips one segment to the view, returning the visible part or null.
 *
 * Liang-Barsky. Needed because keeping only VERTICES inside the view is not an
 * approximation, it is broken: a straight street crossing a small view has both
 * endpoints outside it and often no vertex within at all, so a vertex test
 * discards exactly the roads the viewer is looking at. Measured, that left a
 * 600m view with one label.
 */
function clipSegment(
    [x0, y0]: [number, number],
    [x1, y1]: [number, number],
    view: ViewRect,
): [[number, number], [number, number]] | null {
    let t0 = 0;
    let t1 = 1;
    const dx = x1 - x0;
    const dy = y1 - y0;

    // Each edge as (p, q): the segment is inside when p*t <= q.
    const edges: [number, number][] = [
        [-dx, x0 - view.west],
        [dx, view.east - x0],
        [-dy, y0 - view.south],
        [dy, view.north - y0],
    ];

    for (const [p, q] of edges) {
        if (p === 0) {
            // Parallel to this edge: outside it means the whole segment is out.
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return null;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return null;
            if (r < t1) t1 = r;
        }
    }

    return [
        [x0 + t0 * dx, y0 + t0 * dy],
        [x0 + t1 * dx, y0 + t1 * dy],
    ];
}

/**
 * Splits a way into the parts of it that fall inside the view.
 *
 * Labels must be placed along the VISIBLE part of a street, not along its whole
 * length. A road crossing a small view usually extends far beyond it, so
 * spacing anchors over its full extent and discarding the off-screen ones
 * leaves the view almost unlabelled.
 *
 * Clipped pieces that continue from one another are joined into a single run, so
 * a street crossing the view yields one continuous line to place labels along
 * rather than one per segment.
 */
export function clipToView(
    coords: [number, number][],
    view: ViewRect,
): [number, number][][] {
    const runs: [number, number][][] = [];
    let current: [number, number][] = [];

    const samePoint = (a: [number, number], b: [number, number]) =>
        Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

    for (let i = 1; i < coords.length; i++) {
        const piece = clipSegment(coords[i - 1], coords[i], view);
        if (!piece) {
            if (current.length >= 2) runs.push(current);
            current = [];
            continue;
        }
        const [from, to] = piece;
        if (current.length === 0) {
            current.push(from, to);
        } else if (samePoint(current[current.length - 1], from)) {
            current.push(to);
        } else {
            // A gap: the segment left the view and came back elsewhere.
            if (current.length >= 2) runs.push(current);
            current = [from, to];
        }
    }
    if (current.length >= 2) runs.push(current);
    return runs;
}

/** Most labels one street name may have in view, however long it is. */
const MAX_LABELS_PER_NAME = 3;

/**
 * Groups ways by name, longest first within each group.
 *
 * OSM splits a road into many separate ways — a single arterial is routinely
 * dozens of `way` elements a few hundred metres each. Treating each fragment as
 * its own street breaks placement at both ends of the zoom range: at wide zoom
 * every fragment is shorter than the label spacing and gets skipped, so a major
 * road goes unlabelled entirely; at close zoom every fragment competes for its
 * own label and the name repeats down the street.
 */
export function groupByName(ways: StreetWay[]): Map<string, StreetWay[]> {
    const groups = new Map<string, StreetWay[]>();
    for (const way of ways) {
        const existing = groups.get(way.name);
        if (existing) existing.push(way);
        else groups.set(way.name, [way]);
    }
    for (const group of groups.values()) {
        group.sort((a, b) => polylineLengthDeg(b.coords) - polylineLengthDeg(a.coords));
    }
    return groups;
}

/**
 * Chooses which street labels to draw.
 *
 * Class filter, then one pass per street name over its visible geometry, then a
 * spatial thin against other names.
 */
export function selectStreetLabels(
    ways: StreetWay[],
    cameraHeightM: number,
    limit = 80,
    /** The visible rectangle. Without it, placement spans a whole tile and the
     *  label budget is spent off screen. */
    view?: ViewRect,
): StreetAnchor[] {
    if (cameraHeightM > MAX_STREET_LABEL_HEIGHT_M) return [];

    const maxRank = minimumHighwayRankForHeight(cameraHeightM);
    const spacing = labelSpacingDegrees(cameraHeightM);
    const clip = view ? padView(view) : null;

    const eligible = ways.filter((w) => highwayRank(w.kind) <= maxRank);
    const groups = groupByName(eligible);

    interface Candidate {
        rank: number;
        visibleLength: number;
        pieces: { id: string; name: string; kind: HighwayClass; coords: [number, number][] }[];
    }

    const candidates: Candidate[] = [];
    for (const [name, group] of groups) {
        const pieces: Candidate["pieces"] = [];
        let visibleLength = 0;

        for (const way of group) {
            const runs = clip ? clipToView(way.coords, clip) : [way.coords];
            for (const coords of runs) {
                const length = polylineLengthDeg(coords);
                if (length <= 0) continue;
                visibleLength += length;
                pieces.push({ id: way.id, name, kind: way.kind, coords });
            }
        }
        if (pieces.length === 0) continue;

        pieces.sort((a, b) => polylineLengthDeg(b.coords) - polylineLengthDeg(a.coords));
        candidates.push({ rank: highwayRank(group[0].kind), visibleLength, pieces });
    }

    // Most significant, then longest on screen, so the streets that orient the
    // viewer survive the cap.
    candidates.sort((a, b) => a.rank - b.rank || b.visibleLength - a.visibleLength);

    const anchors: StreetAnchor[] = [];
    for (const candidate of candidates) {
        // Label count follows how much of the street is ON SCREEN, so density
        // stays even as the camera moves rather than depending on how far the
        // road happens to run beyond the view.
        const wanted = Math.max(
            1,
            Math.min(MAX_LABELS_PER_NAME, Math.round(candidate.visibleLength / spacing)),
        );

        let placed = 0;
        for (const piece of candidate.pieces) {
            if (placed >= wanted) break;
            const placedHere = anchorsAlong(
                { id: piece.id, name: piece.name, kind: piece.kind, coords: piece.coords },
                spacing,
                wanted - placed,
                true,
            );
            for (const anchor of placedHere) {
                if (placed >= wanted) break;
                anchors.push(anchor);
                placed++;
            }
        }
    }

    const kept: StreetAnchor[] = [];
    for (const anchor of anchors) {
        if (kept.length >= limit) break;
        const tooClose = kept.some((k) => {
            const dLat = Math.abs(k.lat - anchor.lat);
            const dLon = Math.abs(k.lon - anchor.lon) * lonScale(anchor.lat);
            // Per-name counts are capped above, so this pass only stops
            // different names colliding, plus a wider berth for a repeat of the
            // same name, which reads as redundant rather than as two labels.
            const gap = k.name === anchor.name ? spacing * 2 : spacing * 0.5;
            return dLat < gap && dLon < gap;
        });
        if (!tooClose) kept.push(anchor);
    }
    return kept;
}
