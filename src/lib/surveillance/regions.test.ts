import { describe, expect, it } from "vitest";

import {
    crossesAntimeridian,
    parseBbox,
    parseTiers,
    redisKeyForRegion,
    regionsForBbox,
    withinBbox,
    type DeviceRecord,
} from "./regions";

const device = (lat: number, lon: number): DeviceRecord => ({
    id: `node/${lat}_${lon}`,
    lat,
    lon,
    t: "alpr",
    dir: null,
    tags: {},
});

describe("parseBbox", () => {
    it("parses a well-formed bbox", () => {
        expect(parseBbox("-122.5,37.7,-122.3,37.9")).toEqual({
            west: -122.5,
            south: 37.7,
            east: -122.3,
            north: 37.9,
        });
    });

    it("rejects malformed and out-of-range input", () => {
        expect(parseBbox(null)).toBeNull();
        expect(parseBbox("")).toBeNull();
        expect(parseBbox("1,2,3")).toBeNull();
        expect(parseBbox("a,b,c,d")).toBeNull();
        expect(parseBbox("-181,0,10,10")).toBeNull();
        expect(parseBbox("0,-91,10,10")).toBeNull();
    });

    it("rejects an inverted latitude span but allows an inverted longitude span", () => {
        // south > north is always wrong; west > east is a legitimate
        // antimeridian crossing.
        expect(parseBbox("0,50,10,40")).toBeNull();
        expect(parseBbox("170,-10,-170,10")).not.toBeNull();
    });
});

describe("regionsForBbox", () => {
    it("returns the single region containing a small bbox", () => {
        // San Francisco sits in the 20/-140 cell (lat 20..40, lon -140..-120).
        expect(regionsForBbox({ west: -122.5, south: 37.7, east: -122.3, north: 37.9 })).toEqual([
            "20/-140",
        ]);
    });

    it("covers every cell a bbox spans", () => {
        const keys = regionsForBbox({ west: -125, south: 25, east: -75, north: 45 });
        expect(keys).toEqual(
            expect.arrayContaining(["20/-140", "20/-120", "20/-100", "20/-80", "40/-140", "40/-80"]),
        );
    });

    it("splits an antimeridian-crossing bbox into two longitude spans", () => {
        const keys = regionsForBbox({ west: 170, south: -10, east: -170, north: 10 });
        // Must include cells on both sides and must not walk backwards through
        // the whole globe.
        expect(keys).toEqual(expect.arrayContaining(["-20/160", "0/160", "-20/-180", "0/-180"]));
        expect(keys).not.toContain("0/0");
        expect(keys.length).toBeLessThan(10);
    });

    it("agrees with the seeder's bucketing at the poles", () => {
        // Cell origins are floor(v / 20) * 20, so the latitude rows are
        // -100, -80, ... 80. The -100 row covers -90..-80 and the 80 row
        // covers 80..90. The route MUST use the same origins as the seeder or
        // polar devices land in a tile nobody ever asks for.
        const keys = regionsForBbox({ west: -10, south: -90, east: 10, north: 90 });
        expect(keys).toEqual(expect.arrayContaining(["-100/-20", "80/-20", "80/0"]));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("returns a tile that actually contains an antarctic device", () => {
        const antarctic = device(-85.2, -3.1);
        const keys = regionsForBbox({ west: -5, south: -86, east: -1, north: -84 });
        expect(keys).toContain("-100/-20");
        expect(withinBbox(antarctic, { west: -5, south: -86, east: -1, north: -84 })).toBe(true);
    });
});

describe("crossesAntimeridian", () => {
    it("is true only when west is greater than east", () => {
        expect(crossesAntimeridian({ west: 170, south: 0, east: -170, north: 10 })).toBe(true);
        expect(crossesAntimeridian({ west: -10, south: 0, east: 10, north: 10 })).toBe(false);
    });
});

describe("withinBbox", () => {
    const normal = { west: -10, south: -5, east: 10, north: 5 };

    it("accepts points inside and rejects points outside", () => {
        expect(withinBbox(device(0, 0), normal)).toBe(true);
        expect(withinBbox(device(0, 20), normal)).toBe(false);
        expect(withinBbox(device(50, 0), normal)).toBe(false);
    });

    it("handles an antimeridian-crossing bbox", () => {
        const wrapped = { west: 170, south: -10, east: -170, north: 10 };
        expect(withinBbox(device(0, 175), wrapped)).toBe(true);
        expect(withinBbox(device(0, -175), wrapped)).toBe(true);
        expect(withinBbox(device(0, 0), wrapped)).toBe(false);
    });
});

describe("parseTiers", () => {
    it("keeps known tiers and drops unknown ones", () => {
        expect(parseTiers("alpr,afr")).toEqual(["alpr", "afr"]);
        expect(parseTiers("alpr, public_space ")).toEqual(["alpr", "public_space"]);
        expect(parseTiers("alpr,nonsense")).toEqual(["alpr"]);
    });

    it("returns null when nothing valid remains, meaning no filter", () => {
        expect(parseTiers(null)).toBeNull();
        expect(parseTiers("")).toBeNull();
        expect(parseTiers("nonsense,other")).toBeNull();
    });
});

describe("redisKeyForRegion", () => {
    it("maps a region key onto the seeder's key layout", () => {
        expect(redisKeyForRegion("20/-100")).toBe(
            "data:surveillance-infrastructure:region:20:-100",
        );
    });
});
