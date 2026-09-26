import { describe, expect, it } from "vitest";

import {
    MAX_STREET_LABEL_HEIGHT_M,
    anchorsAlong,
    clipToView,
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

describe("clipToView", () => {
    const view = { west: 0, south: 0, east: 1, north: 1 };

    it("keeps a fully visible line whole", () => {
        const runs = clipToView([[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]], view);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toHaveLength(3);
    });

    it("drops a line entirely outside the view", () => {
        expect(clipToView([[5, 5], [6, 6]], view)).toEqual([]);
    });

    it("keeps a segment that crosses the view with no vertex inside it", () => {
        // The real bug this clipping exists for. A straight street crossing a
        // small view has both endpoints outside and often no vertex within, so
        // a vertex-based test discarded exactly the roads in front of the user.
        const runs = clipToView([[-5, 0.5], [5, 0.5]], view);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toHaveLength(2);
        // Clipped to the view's edges, not to the original endpoints.
        expect(runs[0][0][0]).toBeCloseTo(0, 6);
        expect(runs[0][1][0]).toBeCloseTo(1, 6);
    });

    it("splits when the line leaves and re-enters elsewhere", () => {
        const runs = clipToView(
            [[0.1, 0.1], [0.2, 0.1], [0.2, 5], [0.8, 5], [0.8, 0.9], [0.9, 0.9]],
            view,
        );
        expect(runs.length).toBeGreaterThan(1);
    });

    it("keeps the visible part of a segment leaving the view", () => {
        // Previously discarded, because only one vertex was inside.
        const runs = clipToView([[0.5, 0.5], [5, 5]], view);
        expect(runs).toHaveLength(1);
        expect(runs[0][0]).toEqual([0.5, 0.5]);
    });
});

describe("selectStreetLabels with a view", () => {
    const longRoad = (name: string): StreetWay => ({
        id: `w-${name}`,
        name,
        kind: "primary",
        // Runs far beyond the view in both directions.
        coords: Array.from({ length: 41 }, (_, i): [number, number] => [-2 + i * 0.1, 0.5]),
    });

    it("labels the visible stretch, not the road's whole extent", () => {
        // The failure this guards against: spacing anchors over the full length
        // and then discarding off-screen ones left a crossing road unlabelled.
        const view = { west: 0, south: 0.48, east: 0.3, north: 0.52 };
        const kept = selectStreetLabels([longRoad("Long Ave")], 500, 80, view);
        expect(kept.length).toBeGreaterThan(0);
        for (const anchor of kept) {
            expect(anchor.lon).toBeGreaterThan(view.west - 0.2);
            expect(anchor.lon).toBeLessThan(view.east + 0.2);
        }
    });

    it("ignores a road that does not reach the view", () => {
        const view = { west: 50, south: 50, east: 51, north: 51 };
        expect(selectStreetLabels([longRoad("Long Ave")], 500, 80, view)).toEqual([]);
    });
});
