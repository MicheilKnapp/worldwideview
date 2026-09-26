import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * Archive selection, which is the part of the PMTiles source that is easy to get
 * subtly wrong. A header states only a bounding box, and an extract's bbox is
 * always looser than the tiles it actually holds — a United States extract
 * reaches well into Canada and Mexico — so "this archive covers the tile" and
 * "this archive has the tile" are different questions.
 */

const getZxy = vi.fn();
const getHeader = vi.fn();

vi.mock("pmtiles", () => ({
    PMTiles: class {
        constructor(public source: { location: string }) {}
        getHeader() {
            return getHeader(this.source.location);
        }
        getZxy(z: number, x: number, y: number) {
            return getZxy(this.source.location, z, x, y);
        }
    },
    FetchSource: class {
        constructor(public location: string) {}
    },
}));

vi.mock("./nodeFileSource", () => ({
    NodeFileSource: class {
        constructor(public location: string) {}
    },
}));

import { getVectorTile, resetPmtilesSource, tileBounds } from "./pmtilesSource";

/** Bounds roughly matching a CONUS extract — note they include Toronto. */
const US_HEADER = {
    minZoom: 0,
    maxZoom: 14,
    minLon: -125,
    minLat: 24.4,
    maxLon: -66.9,
    maxLat: 49.4,
};
const NA_HEADER = {
    minZoom: 0,
    maxZoom: 12,
    minLon: -141,
    minLat: 14.5,
    maxLon: -52.6,
    maxLat: 70,
};
const WORLD_HEADER = { minZoom: 0, maxZoom: 9, minLon: -180, minLat: -85, maxLon: 180, maxLat: 85 };

/** Slippy tile containing a lon/lat at a zoom. */
function tileAt(lon: number, lat: number, z: number) {
    const n = 2 ** z;
    const latRad = (lat * Math.PI) / 180;
    return {
        z,
        x: Math.floor(((lon + 180) / 360) * n),
        y: Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
        ),
    };
}

const TORONTO = { lon: -79.38, lat: 43.65 };
const DENVER = { lon: -104.99, lat: 39.74 };
const MID_PACIFIC = { lon: -150, lat: 5 };

beforeEach(() => {
    getZxy.mockReset();
    getHeader.mockReset();
    resetPmtilesSource();
    process.env.PMTILES_ARCHIVES = "/d/us.pmtiles,/d/na.pmtiles,/d/world.pmtiles";
    getHeader.mockImplementation((loc: string) => {
        if (loc.includes("us")) return Promise.resolve(US_HEADER);
        if (loc.includes("na")) return Promise.resolve(NA_HEADER);
        return Promise.resolve(WORLD_HEADER);
    });
});

afterEach(() => {
    delete process.env.PMTILES_ARCHIVES;
    resetPmtilesSource();
});

describe("getVectorTile archive selection", () => {
    it("prefers the most detailed archive that has the tile", async () => {
        const coord = tileAt(DENVER.lon, DENVER.lat, 14);
        getZxy.mockImplementation((loc: string) =>
            loc.includes("us")
                ? Promise.resolve({ data: new ArrayBuffer(8) })
                : Promise.resolve(undefined),
        );

        const result = await getVectorTile(coord);
        expect(result?.archive).toBe("/d/us.pmtiles");
        expect(result?.z).toBe(14);
    });

    it("falls through to a coarser archive when a covering archive has no tile", async () => {
        // Toronto sits INSIDE the US extract's bounding box but outside its data.
        // If an empty answer were treated as authoritative, na.pmtiles would
        // never be asked and Canada would have no labels at all.
        const coord = tileAt(TORONTO.lon, TORONTO.lat, 12);
        expect(tileBounds(coord).west).toBeGreaterThan(US_HEADER.minLon);
        expect(tileBounds(coord).north).toBeLessThan(US_HEADER.maxLat);

        getZxy.mockImplementation((loc: string) =>
            loc.includes("na")
                ? Promise.resolve({ data: new ArrayBuffer(8) })
                : Promise.resolve(undefined),
        );

        const result = await getVectorTile(coord);
        expect(result?.archive).toBe("/d/na.pmtiles");
        expect(getZxy).toHaveBeenCalledWith("/d/us.pmtiles", 12, coord.x, coord.y);
    });

    it("retries at a coarser zoom when no archive holds the requested one", async () => {
        // Paris at z14: only the world archive covers it, and only to z9.
        const coord = tileAt(2.35, 48.86, 14);
        getZxy.mockImplementation((loc: string, z: number) =>
            loc.includes("world") && z === 9
                ? Promise.resolve({ data: new ArrayBuffer(8) })
                : Promise.resolve(undefined),
        );

        const result = await getVectorTile(coord);
        expect(result?.archive).toBe("/d/world.pmtiles");
        expect(result?.z).toBe(9);
    });

    it("stops without walking to z0 when every covering archive agrees it is empty", async () => {
        const coord = tileAt(MID_PACIFIC.lon, MID_PACIFIC.lat, 9);
        getZxy.mockResolvedValue(undefined);

        expect(await getVectorTile(coord)).toBeNull();
        // Only the world archive covers open ocean, and only at the one zoom.
        expect(getZxy).toHaveBeenCalledTimes(1);
    });

    it("does not treat a read failure as proof the tile is absent", async () => {
        const coord = tileAt(DENVER.lon, DENVER.lat, 12);
        getZxy.mockImplementation((loc: string) => {
            if (loc.includes("us")) return Promise.reject(new Error("corrupt archive"));
            if (loc.includes("na")) return Promise.resolve({ data: new ArrayBuffer(8) });
            return Promise.resolve(undefined);
        });

        const result = await getVectorTile(coord);
        expect(result?.archive).toBe("/d/na.pmtiles");
    });

    it("skips an archive whose header cannot be read", async () => {
        const coord = tileAt(DENVER.lon, DENVER.lat, 12);
        getHeader.mockImplementation((loc: string) => {
            if (loc.includes("us")) return Promise.reject(new Error("truncated"));
            if (loc.includes("na")) return Promise.resolve(NA_HEADER);
            return Promise.resolve(WORLD_HEADER);
        });
        getZxy.mockImplementation((loc: string) =>
            loc.includes("na")
                ? Promise.resolve({ data: new ArrayBuffer(8) })
                : Promise.resolve(undefined),
        );

        const result = await getVectorTile(coord);
        expect(result?.archive).toBe("/d/na.pmtiles");
        expect(getZxy).not.toHaveBeenCalledWith("/d/us.pmtiles", 12, coord.x, coord.y);
    });
});
