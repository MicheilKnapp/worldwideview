import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted: the mock factories below are hoisted above these declarations, so
// the shared spies have to be created in a hoisted block to exist in time.
type Coord = { z: number; x: number; y: number };

const mocks = vi.hoisted(() => {
    type Decoder = (data: ArrayBuffer, coord: { z: number; x: number; y: number }) => unknown[];
    // Explicit signatures: an inferred `vi.fn(() => [])` has an empty argument
    // tuple, so mock.calls[n][1] would not type-check.
    return {
        getVectorTile: vi.fn(),
        decodeStreets: vi.fn<Decoder>(() => []),
        decodePlaces: vi.fn<Decoder>(() => []),
    };
});

vi.mock("./pmtilesSource", () => ({
    isPmtilesConfigured: () => true,
    getVectorTile: mocks.getVectorTile,
}));

vi.mock("./decodeTile", () => ({
    decodeStreets: mocks.decodeStreets,
    decodePlaces: mocks.decodePlaces,
}));

import {
    fetchPlacesFromTiles,
    fetchStreetsFromTiles,
    tilesCovering,
    zoomForBbox,
} from "./fetchFromTiles";

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

describe("decoding a coarser tile than was requested", () => {
    /**
     * A tiered archive set answers a street-zoom request with whatever detail it
     * has: z14 from the US extract, z12 from the planet one. The bytes that come
     * back belong to THAT tile, and a vector tile's geometry is relative to its
     * own tile — so decoding needs the served z, x and y together.
     *
     * Pairing the served zoom with the requested x and y was live on the site and
     * broke every label outside the zoom where the two happened to coincide.
     * Paris asked for z15, the world archive served z12, and decoding z12 data
     * with z15 coordinates placed features at longitude 2737, latitude -90.
     * Everything was silently discarded, with no error anywhere.
     */
    const PARIS_Z12 = { z: 12, x: 2074, y: 1409 };
    const view = bbox(2.34, 48.85, 2.36, 48.87);

    beforeEach(() => {
        mocks.getVectorTile.mockReset();
        mocks.decodeStreets.mockReset().mockReturnValue([]);
        mocks.decodePlaces.mockReset().mockReturnValue([]);
        mocks.getVectorTile.mockResolvedValue({
            data: new ArrayBuffer(8),
            archive: "/d/world.pmtiles",
            coord: PARIS_Z12,
        });
    });

    it("decodes streets against the served tile, not the requested one", async () => {
        await fetchStreetsFromTiles(view);

        expect(mocks.decodeStreets).toHaveBeenCalled();
        for (const call of mocks.decodeStreets.mock.calls) {
            expect(call[1]).toEqual(PARIS_Z12);
        }
    });

    it("decodes places against the served tile, not the requested one", async () => {
        await fetchPlacesFromTiles(view);

        expect(mocks.decodePlaces).toHaveBeenCalled();
        for (const call of mocks.decodePlaces.mock.calls) {
            expect(call[1]).toEqual(PARIS_Z12);
        }
    });

    it("never pairs the served zoom with the requested x and y", async () => {
        await fetchStreetsFromTiles(view);

        const requestedZoom = zoomForBbox(view, 15);
        expect(requestedZoom).toBeGreaterThan(PARIS_Z12.z);
        for (const call of mocks.decodeStreets.mock.calls) {
            const coord: Coord = call[1];
            // The whole failure was x and y surviving from a finer request.
            expect(coord.x).toBe(PARIS_Z12.x);
            expect(coord.y).toBe(PARIS_Z12.y);
        }
    });
});
