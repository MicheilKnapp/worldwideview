import { describe, expect, it } from "vitest";

import {
    minSeparationDegrees,
    minimumRankForHeight,
    placeRank,
    selectVisiblePlaces,
    type PlaceKind,
    type PlaceLabel,
} from "./places";

const place = (
    name: string,
    kind: PlaceKind,
    lat: number,
    lon: number,
    population = 0,
): PlaceLabel => ({ id: name, name, kind, lat, lon, population });

describe("placeRank", () => {
    it("orders a city above a neighbourhood", () => {
        expect(placeRank(place("A", "city", 0, 0))).toBeLessThan(
            placeRank(place("B", "neighbourhood", 0, 0)),
        );
    });
});

describe("minimumRankForHeight", () => {
    it("admits progressively smaller places as the camera descends", () => {
        const orbit = minimumRankForHeight(2_000_000);
        const country = minimumRankForHeight(400_000);
        const region = minimumRankForHeight(120_000);
        const street = minimumRankForHeight(5_000);
        expect(orbit).toBeLessThan(country);
        expect(country).toBeLessThan(region);
        expect(region).toBeLessThan(street);
    });
});

describe("minSeparationDegrees", () => {
    it("requires less spacing the closer the camera gets", () => {
        expect(minSeparationDegrees(2_000_000)).toBeGreaterThan(minSeparationDegrees(400_000));
        expect(minSeparationDegrees(400_000)).toBeGreaterThan(minSeparationDegrees(5_000));
    });
});

describe("selectVisiblePlaces", () => {
    it("drops places too small to matter at this height", () => {
        const kept = selectVisiblePlaces(
            [place("Big", "city", 0, 0), place("Tiny", "hamlet", 40, 40)],
            2_000_000,
        );
        expect(kept.map((p) => p.name)).toEqual(["Big"]);
    });

    it("keeps the most important of an overlapping cluster", () => {
        // All within the separation distance of each other at this height.
        const kept = selectVisiblePlaces(
            [
                place("Suburb", "suburb", 51.50, -0.12),
                place("City", "city", 51.51, -0.13),
                place("Village", "village", 51.505, -0.125),
            ],
            50_000,
        );
        expect(kept.map((p) => p.name)).toEqual(["City"]);
    });

    it("keeps places that are far enough apart", () => {
        const kept = selectVisiblePlaces(
            [place("West", "town", 0, 0), place("East", "town", 0, 30)],
            300_000,
        );
        expect(kept).toHaveLength(2);
    });

    it("breaks ties within a kind by population", () => {
        const kept = selectVisiblePlaces(
            [place("Small", "town", 0, 0, 2_000), place("Large", "town", 0.01, 0.01, 90_000)],
            300_000,
        );
        expect(kept.map((p) => p.name)).toEqual(["Large"]);
    });

    it("honours the hard ceiling", () => {
        // Spread far apart so separation never thins them; only the cap should.
        const many = Array.from({ length: 50 }, (_, i) => place(`P${i}`, "city", i * 3, i * 3));
        expect(selectVisiblePlaces(many, 2_000_000, 10)).toHaveLength(10);
    });

    it("returns nothing for an empty input", () => {
        expect(selectVisiblePlaces([], 10_000)).toEqual([]);
    });
});
