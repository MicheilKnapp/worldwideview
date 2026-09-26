import { describe, expect, it } from "vitest";

import {
    MAX_STREET_LABEL_HEIGHT_M,
    anchorsAlong,
    highwayRank,
    labelSpacingDegrees,
    minimumHighwayRankForHeight,
    polylineLengthDeg,
    selectStreetLabels,
    type HighwayClass,
    type StreetWay,
} from "./streets";

/** A straight east-west road of a given length in degrees of longitude. */
const road = (
    id: string,
    name: string,
    kind: HighwayClass,
    lengthDeg: number,
    lat = 0,
    lon = 0,
): StreetWay => ({
    id,
    name,
    kind,
    coords: [
        [lon, lat],
        [lon + lengthDeg, lat],
    ],
});

describe("highwayRank", () => {
    it("ranks arterials above residential streets", () => {
        expect(highwayRank("motorway")).toBeLessThan(highwayRank("residential"));
        expect(highwayRank("primary")).toBeLessThan(highwayRank("tertiary"));
    });
});

describe("minimumHighwayRankForHeight", () => {
    it("admits smaller roads only as the camera descends", () => {
        expect(minimumHighwayRankForHeight(3_500)).toBeLessThan(
            minimumHighwayRankForHeight(2_000),
        );
        expect(minimumHighwayRankForHeight(2_000)).toBeLessThan(
            minimumHighwayRankForHeight(500),
        );
    });
});

describe("labelSpacingDegrees", () => {
    it("packs labels closer together as the camera descends", () => {
        expect(labelSpacingDegrees(3_500)).toBeGreaterThan(labelSpacingDegrees(1_000));
        expect(labelSpacingDegrees(1_000)).toBeGreaterThan(labelSpacingDegrees(300));
    });
});

describe("polylineLengthDeg", () => {
    it("sums segments", () => {
        expect(polylineLengthDeg([[0, 0], [0.01, 0], [0.02, 0]])).toBeCloseTo(0.02, 6);
    });

    it("corrects longitude for latitude", () => {
        // A degree of longitude covers less ground near the poles, so the same
        // delta must measure shorter at high latitude.
        const equator = polylineLengthDeg([[0, 0], [1, 0]]);
        const north = polylineLengthDeg([[0, 60], [1, 60]]);
        expect(north).toBeLessThan(equator);
        expect(north).toBeCloseTo(0.5, 2);
    });

    it("is zero for a degenerate line", () => {
        expect(polylineLengthDeg([[1, 1]])).toBe(0);
    });
});

describe("anchorsAlong", () => {
    it("places labels inside the line, never at its endpoints", () => {
        const anchors = anchorsAlong(road("w1", "Main St", "residential", 0.01), 0.003);
        expect(anchors.length).toBeGreaterThan(0);
        for (const a of anchors) {
            // A vertex is usually a corner, and text aligned to a corner looks
            // wrong against both segments meeting there.
            expect(a.lon).toBeGreaterThan(0);
            expect(a.lon).toBeLessThan(0.01);
        }
    });

    it("spaces multiple labels along a long road", () => {
        const anchors = anchorsAlong(road("w1", "Long Rd", "primary", 0.02), 0.005);
        expect(anchors.length).toBeGreaterThan(1);
        const lons = anchors.map((a) => a.lon).sort((x, y) => x - y);
        expect(lons[1] - lons[0]).toBeGreaterThan(0);
    });

    it("carries a forward point so the renderer can derive a screen angle", () => {
        // Geographic bearing cannot be baked in: the on-screen direction
        // depends on camera heading and tilt.
        const [a] = anchorsAlong(road("w1", "Main St", "residential", 0.01), 0.01);
        expect(a.aheadLon).not.toBe(a.lon);
        expect(Number.isFinite(a.aheadLat)).toBe(true);
    });

    it("skips roads too short to carry a name at this zoom", () => {
        expect(anchorsAlong(road("w1", "Tiny", "residential", 0.0001), 0.01)).toEqual([]);
    });

    it("caps labels per way so one motorway cannot flood the view", () => {
        expect(anchorsAlong(road("w1", "Endless", "motorway", 5), 0.001, 4)).toHaveLength(4);
    });

    it("ignores a way with too few points", () => {
        expect(anchorsAlong({ id: "x", name: "N", kind: "residential", coords: [[0, 0]] }, 0.01))
            .toEqual([]);
    });
});

describe("selectStreetLabels", () => {
    it("draws nothing above the street-label height", () => {
        const ways = [road("w1", "Main St", "primary", 0.02)];
        expect(selectStreetLabels(ways, MAX_STREET_LABEL_HEIGHT_M + 1)).toEqual([]);
    });

    it("drops road classes too minor for the height", () => {
        const ways = [
            road("w1", "Big Ave", "primary", 0.02),
            road("w2", "Back Ln", "residential", 0.02, 0.05),
        ];
        const names = new Set(selectStreetLabels(ways, 3_500).map((a) => a.name));
        expect(names.has("Big Ave")).toBe(true);
        expect(names.has("Back Ln")).toBe(false);
    });

    it("includes residential streets once close in", () => {
        const ways = [road("w2", "Back Ln", "residential", 0.01)];
        expect(selectStreetLabels(ways, 400).length).toBeGreaterThan(0);
    });

    it("does not repeat one name on top of itself", () => {
        // Two segments of the same street, adjacent. Repeating the name within
        // a block is noise rather than information.
        const ways = [
            road("w1", "Main St", "residential", 0.002, 0, 0),
            road("w2", "Main St", "residential", 0.002, 0, 0.002),
        ];
        const kept = selectStreetLabels(ways, 500);
        expect(kept.filter((a) => a.name === "Main St")).toHaveLength(1);
    });

    it("still repeats a name along one long road", () => {
        // The counterpart to the rule above: suppressing same-name anchors
        // outright would leave a single label on a motorway.
        const kept = selectStreetLabels([road("w1", "Long Rd", "primary", 0.08)], 3_500);
        expect(kept.filter((a) => a.name === "Long Rd").length).toBeGreaterThan(1);
    });

    it("honours the overall ceiling", () => {
        const ways = Array.from({ length: 200 }, (_, i) =>
            road(`w${i}`, `Street ${i}`, "residential", 0.004, i * 0.05),
        );
        expect(selectStreetLabels(ways, 500, 20)).toHaveLength(20);
    });

    it("returns nothing for no input", () => {
        expect(selectStreetLabels([], 500)).toEqual([]);
    });
});
