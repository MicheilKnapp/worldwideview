/**
 * Polyline simplification (Ramer–Douglas–Peucker).
 *
 * Overpass `out geom` returns every coordinate OSM holds for a way, which is far
 * more detail than a label needs. Labels only require a position and a local
 * direction, so survey-grade vertices cost transfer size and parse time and buy
 * nothing. Simplifying before caching shrinks the payload and the cache entry.
 *
 * The tolerance is deliberately tight: direction is derived from the segment a
 * label sits on, so flattening a curve too aggressively would tilt the text
 * away from the road it names.
 */

/** ~5 metres at the equator. Below the width of the roads being labelled. */
export const SIMPLIFY_TOLERANCE_DEG = 0.00005;

/** Perpendicular distance from p to the line through a and b. */
function perpendicularDistance(
    p: [number, number],
    a: [number, number],
    b: [number, number],
): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) {
        return Math.hypot(p[0] - a[0], p[1] - a[1]);
    }
    // Twice the triangle area over the base length.
    const area = Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0]));
    return area / Math.hypot(dx, dy);
}

/**
 * Simplifies a polyline, always keeping its first and last points.
 *
 * @param coords [lon, lat] pairs.
 * @param tolerance Maximum perpendicular deviation permitted, in degrees.
 */
export function simplifyPolyline(
    coords: [number, number][],
    tolerance: number = SIMPLIFY_TOLERANCE_DEG,
): [number, number][] {
    if (coords.length <= 2 || tolerance <= 0) return coords;

    // Iterative rather than recursive: a way can carry thousands of points, and
    // a deep recursion on untrusted input risks a stack overflow.
    const keep = new Array<boolean>(coords.length).fill(false);
    keep[0] = true;
    keep[coords.length - 1] = true;

    const stack: [number, number][] = [[0, coords.length - 1]];
    while (stack.length > 0) {
        const [first, last] = stack.pop()!;
        if (last <= first + 1) continue;

        let maxDist = 0;
        let maxIndex = first;
        for (let i = first + 1; i < last; i++) {
            const dist = perpendicularDistance(coords[i], coords[first], coords[last]);
            if (dist > maxDist) {
                maxDist = dist;
                maxIndex = i;
            }
        }

        if (maxDist > tolerance) {
            keep[maxIndex] = true;
            stack.push([first, maxIndex], [maxIndex, last]);
        }
    }

    return coords.filter((_, i) => keep[i]);
}
