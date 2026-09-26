import { describe, expect, it } from "vitest";

import { tilesCovering, zoomForBbox } from "./fetchFromTiles";

const bbox = (west: number, south: number, east: number, north: number) => ({
    west,
    south,
    east,
    north,
});

describe("zoomForBbox", () => {
    it("picks a higher zoom for a narrower view", () => {
        const world = zoomForBbox(bbox(-180, -85, 180, 85), 15);
        const city = zoomForBbox(bbox(-0.2, 51.4, 0.1, 51.6), 15);
        const street = zoomForBbox(bbox(-81.04, 29.22, -81.02, 29.23), 15);
        expect(city).toBeGreaterThan(world);
        expect(street).toBeGreaterThan(city);
    });

    it("never exceeds the archive's maximum zoom", () => {
        // Requesting detail an extract does not contain would read nothing.
        expect(zoomForBbox(bbox(-81.04, 29.22, -81.02, 29.23), 10)).toBeLessThanOrEqual(10);
        expect(zoomForBbox(bbox(-81.04, 29.22, -81.02, 29.23), 8)).toBeLessThanOrEqual(8);
    });

    it("keeps the tile count small at the chosen zoom", () => {
        for (const view of [
            bbox(-180, -85, 180, 85),
            bbox(-0.51, 51.28, 0.33, 51.69),
            bbox(-81.06, 29.21, -81.0, 29.24),
        ]) {
            const z = zoomForBbox(view, 15);
            expect(tilesCovering(view, z).length).toBeLessThanOrEqual(12);
        }
    });
});

describe("tilesCovering", () => {
    it("returns a single tile for a view inside one", () => {
        // Deliberately away from lon 0: at zoom 6 the prime meridian is itself a
        // tile boundary, so a view straddling it correctly spans two tiles.
        expect(tilesCovering(bbox(1.0, 51.5, 1.1, 51.51), 6)).toHaveLength(1);
    });

    it("spans two tiles across the prime meridian", () => {
        expect(tilesCovering(bbox(-0.001, 51.5, 0.001, 51.501), 6)).toHaveLength(2);
    });

    it("covers both sides of a tile boundary", () => {
        const tiles = tilesCovering(bbox(-0.2, 51.4, 0.2, 51.6), 10);
        expect(tiles.length).toBeGreaterThan(1);
    });

    it("honours the cap on a pathological request", () => {
        // A wide view at street zoom would otherwise be thousands of tiles.
        expect(tilesCovering(bbox(-180, -85, 180, 85), 15, 12)).toHaveLength(12);
    });

    it("puts a known coordinate in the expected tile", () => {
        // Null island at zoom 1 sits at the meeting of all four tiles; the
        // north-east quadrant is x=1, y=0.
        expect(tilesCovering(bbox(0.1, 0.1, 0.2, 0.2), 1)).toEqual([{ z: 1, x: 1, y: 0 }]);
    });

    it("clamps latitudes beyond the Mercator limit", () => {
        // Web Mercator cannot represent the poles; an unclamped tan() would
        // produce NaN tile indices.
        const tiles = tilesCovering(bbox(-10, -89.9, 10, 89.9), 2);
        for (const t of tiles) {
            expect(Number.isFinite(t.x)).toBe(true);
            expect(Number.isFinite(t.y)).toBe(true);
        }
    });
});
