import { describe, expect, it } from "vitest";

import {
    DETAIL_BELOW_M,
    DETAIL_LAYER_ID,
    GLOBAL_ABOVE_M,
    nextZoomLayer,
} from "./zoomImagery";

describe("nextZoomLayer", () => {
    it("switches to the detail layer once the view narrows to state level", () => {
        expect(nextZoomLayer(DETAIL_BELOW_M - 1, null)).toBe(DETAIL_LAYER_ID);
        expect(nextZoomLayer(50_000, null)).toBe(DETAIL_LAYER_ID);
    });

    it("stays on the global layer while still zoomed out", () => {
        expect(nextZoomLayer(DETAIL_BELOW_M + 1, null)).toBeNull();
        expect(nextZoomLayer(20_000_000, null)).toBeNull();
    });

    it("returns to the global layer only above the upper threshold", () => {
        expect(nextZoomLayer(GLOBAL_ABOVE_M + 1, DETAIL_LAYER_ID)).toBeNull();
        expect(nextZoomLayer(5_000_000, DETAIL_LAYER_ID)).toBeNull();
    });

    it("holds the detail layer inside the hysteresis band", () => {
        // Between the two thresholds nothing changes, whichever side it came
        // from. A single boundary here would flap on every small camera drift.
        const mid = (DETAIL_BELOW_M + GLOBAL_ABOVE_M) / 2;
        expect(nextZoomLayer(mid, DETAIL_LAYER_ID)).toBe(DETAIL_LAYER_ID);
        expect(nextZoomLayer(mid, null)).toBeNull();
    });

    it("has a real hysteresis band, not a single boundary", () => {
        expect(GLOBAL_ABOVE_M).toBeGreaterThan(DETAIL_BELOW_M);
    });

    it("holds state when the height is not usable", () => {
        // Fully zoomed out or mid-morph between scene modes.
        expect(nextZoomLayer(Number.NaN, DETAIL_LAYER_ID)).toBe(DETAIL_LAYER_ID);
        expect(nextZoomLayer(Number.NaN, null)).toBeNull();
        expect(nextZoomLayer(Number.POSITIVE_INFINITY, DETAIL_LAYER_ID)).toBe(DETAIL_LAYER_ID);
    });

    it("is idempotent, so a settled camera never rewrites the store", () => {
        expect(nextZoomLayer(100_000, DETAIL_LAYER_ID)).toBe(DETAIL_LAYER_ID);
        expect(nextZoomLayer(9_000_000, null)).toBeNull();
    });
});
