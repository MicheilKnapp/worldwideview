import { describe, expect, it } from "vitest";

import { MAX_TILES_PER_VIEW, chooseTileSize, tileBbox, tileCacheKey, tilesForBbox, type Bbox, streetTilesForBbox, chooseStreetTileSize, MAX_STREET_TILES_PER_VIEW, STREET_TILE_SIZES_DEG } from "./tiles";

const bbox = (west: number, south: number, east: number, north: number): Bbox => ({
    west,
    south,
    east,
    north,
});

describe("chooseTileSize", () => {
    it("uses smaller tiles as the view narrows", () => {
        const wide = chooseTileSize(bbox(-30, 0, 30, 40));
        const city = chooseTileSize(bbox(-0.5, 51.3, 0.3, 51.7));
        const street = chooseTileSize(bbox(-81.08, 29.22, -80.99, 29.27));
        expect(wide).toBeGreaterThan(city);
        expect(city).toBeGreaterThanOrEqual(street);
    });
});

describe("tilesForBbox", () => {
    it("never exceeds the per-view cap, at any zoom", () => {
        // The cap is the whole point: request count must be bounded by
        // geography, not by how far the user has zoomed out.
        const views = [
            bbox(-81.08, 29.22, -80.99, 29.27),
            bbox(-0.51, 51.28, 0.33, 51.69),
            bbox(-30, 0, 30, 40),
            bbox(-179, -80, 179, 80),
        ];
        for (const v of views) {
            expect(tilesForBbox(v).length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW);
        }
    });

    it("returns the same tiles when panning inside one tile", () => {
        // This is what stops every camera nudge minting a new upstream query.
        const a = tilesForBbox(bbox(-81.08, 29.22, -80.99, 29.27));
        const b = tilesForBbox(bbox(-81.07, 29.23, -80.98, 29.28));
        expect(tileCacheKey(b[0])).toBe(tileCacheKey(a[0]));
    });

    it("snaps tiles to the grid", () => {
        const [tile] = tilesForBbox(bbox(-81.08, 29.22, -80.99, 29.27));
        expect(tile.lat % tile.size).toBeCloseTo(0, 6);
        expect(tile.lon % tile.size).toBeCloseTo(0, 6);
    });

    it("covers a view that straddles a tile boundary", () => {
        // Straddling must return both sides, or half the view loses its labels.
        const tiles = tilesForBbox(bbox(-0.02, 51.49, 0.02, 51.51));
        const lons = new Set(tiles.map((t) => t.lon));
        expect(lons.size).toBeGreaterThan(1);
    });
});

describe("tileBbox", () => {
    it("round-trips a tile into a box of its own size", () => {
        const [tile] = tilesForBbox(bbox(-0.51, 51.28, 0.33, 51.69));
        const box = tileBbox(tile);
        expect(box.east - box.west).toBeCloseTo(tile.size, 6);
        expect(box.north - box.south).toBeCloseTo(tile.size, 6);
        expect(box.west).toBe(tile.lon);
    });
});

describe("tileCacheKey", () => {
    it("distinguishes tiles by size as well as position", () => {
        const a = tileCacheKey({ lat: 29, lon: -81, size: 0.5 });
        const b = tileCacheKey({ lat: 29, lon: -81, size: 1 });
        expect(a).not.toBe(b);
    });
});

describe("street tiles cover the whole view", () => {
    /** True when the tiles' union spans the bbox on both axes. */
    function covers(bbox: {
        west: number;
        south: number;
        east: number;
        north: number;
    }): boolean {
        const tiles = streetTilesForBbox(bbox);
        if (tiles.length === 0) return false;
        const size = tiles[0].size;
        const west = Math.min(...tiles.map((t) => t.lon));
        const east = Math.max(...tiles.map((t) => t.lon)) + size;
        const south = Math.min(...tiles.map((t) => t.lat));
        const north = Math.max(...tiles.map((t) => t.lat)) + size;
        return west <= bbox.west && east >= bbox.east && south <= bbox.south && north >= bbox.north;
    }

    /**
     * Truncation does not degrade gracefully. Tiles enumerate from the
     * south-west, so a list cut short by the per-view cap labels the bottom-left
     * of the screen and leaves the rest blank — which reads as a rendering bug,
     * not as a budget.
     */
    it("covers a view at the top of the street-label range", () => {
        // ~0.25 degrees is roughly what a 15km camera height spans.
        expect(covers({ west: 2.2, south: 48.75, east: 2.45, north: 49.0 })).toBe(true);
    });

    it("covers a close-in view", () => {
        expect(covers({ west: 2.34, south: 48.85, east: 2.36, north: 48.87 })).toBe(true);
    });

    it("covers a view that straddles the prime meridian", () => {
        expect(covers({ west: -0.08, south: 51.5, east: 0.04, north: 51.56 })).toBe(true);
    });

    it("never exceeds the street tile budget", () => {
        for (const span of [0.01, 0.05, 0.12, 0.25, 0.5, 1]) {
            const tiles = streetTilesForBbox({ west: 0, south: 40, east: span, north: 40 + span });
            expect(tiles.length).toBeLessThanOrEqual(MAX_STREET_TILES_PER_VIEW);
        }
    });

    it("picks a finer tile for a closer view", () => {
        const wide = chooseStreetTileSize({ west: 2.2, south: 48.75, east: 2.45, north: 49.0 });
        const close = chooseStreetTileSize({ west: 2.34, south: 48.85, east: 2.35, north: 48.86 });
        expect(close).toBeLessThan(wide);
        expect(STREET_TILE_SIZES_DEG).toContain(wide);
    });
});
