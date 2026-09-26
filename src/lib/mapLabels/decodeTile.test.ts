import { describe, expect, it } from "vitest";

import {
    featureName,
    highwayKindOf,
    placeKindOf,
    significanceOf,
} from "./decodeTile";

describe("featureName", () => {
    it("prefers the local name over the English one", () => {
        // Endonyms are what a map of a place normally shows.
        expect(featureName({ name: "München", "name:en": "Munich" })).toBe("München");
    });

    it("falls back to English when there is no plain name", () => {
        expect(featureName({ "name:en": "Munich" })).toBe("Munich");
    });

    it("is null when unnamed", () => {
        expect(featureName({})).toBeNull();
        expect(featureName({ name: "" })).toBeNull();
        expect(featureName({ name: 42 })).toBeNull();
    });
});

describe("placeKindOf", () => {
    it("prefers kind_detail, which carries the specific type", () => {
        // Protomaps reports `locality` as kind and `city` as kind_detail; using
        // kind alone would lump cities and villages together.
        expect(placeKindOf({ kind: "locality", kind_detail: "city" })).toBe("city");
        expect(placeKindOf({ kind: "locality", kind_detail: "village" })).toBe("village");
    });

    it("falls back to kind when detail is absent or unknown", () => {
        expect(placeKindOf({ kind: "neighbourhood" })).toBe("neighbourhood");
        expect(placeKindOf({ kind: "suburb", kind_detail: "something_new" })).toBe("suburb");
    });

    it("is null for kinds this app does not label", () => {
        expect(placeKindOf({ kind: "country" })).toBeNull();
        expect(placeKindOf({ kind: "region", kind_detail: "state" })).toBeNull();
        expect(placeKindOf({})).toBeNull();
    });
});

describe("highwayKindOf", () => {
    it("maps road detail onto the highway classes", () => {
        expect(highwayKindOf({ kind: "highway", kind_detail: "motorway" })).toBe("motorway");
        expect(highwayKindOf({ kind: "minor_road", kind_detail: "residential" })).toBe("residential");
    });

    it("is null for transport this app does not label", () => {
        // The roads layer also carries rail and piers.
        expect(highwayKindOf({ kind: "rail", kind_detail: "rail" })).toBeNull();
        expect(highwayKindOf({})).toBeNull();
    });
});

describe("significanceOf", () => {
    it("uses population when present", () => {
        expect(significanceOf({ population: 120_000 })).toBe(120_000);
    });

    it("parses a population written with separators", () => {
        expect(significanceOf({ population: "1,200,000" })).toBe(1_200_000);
    });

    it("falls back to population_rank, scaled to compare against counts", () => {
        // selectVisiblePlaces compares this field numerically against real
        // populations, so a small ordinal has to be scaled into the same space.
        const ranked = significanceOf({ population_rank: 11 });
        expect(ranked).toBeGreaterThan(0);
        expect(significanceOf({ population_rank: 13 })).toBeGreaterThan(ranked);
    });

    it("prefers a real population over a rank", () => {
        expect(significanceOf({ population: 5_000, population_rank: 3 })).toBe(5_000);
    });

    it("is zero when neither is known", () => {
        expect(significanceOf({})).toBe(0);
    });
});
