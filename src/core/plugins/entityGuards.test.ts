import { describe, expect, it } from "vitest";

import type { GeoEntity } from "@/core/plugins/PluginTypes";
import { isRenderableEntity, partitionRenderable } from "./entityGuards";

const at = (latitude: unknown, longitude: unknown): GeoEntity =>
    ({
        id: `e-${latitude}-${longitude}`,
        pluginId: "test",
        latitude,
        longitude,
        timestamp: new Date(),
        properties: {},
    }) as unknown as GeoEntity;

describe("isRenderableEntity", () => {
    it("accepts ordinary coordinates, including zero", () => {
        expect(isRenderableEntity(at(51.5, -0.12))).toBe(true);
        // 0 is a real coordinate and must not be treated as missing.
        expect(isRenderableEntity(at(0, 0))).toBe(true);
        expect(isRenderableEntity(at(-90, 180))).toBe(true);
    });

    it("rejects undefined coordinates", () => {
        // This is the aviation crash: Cartesian3.fromDegrees throws a
        // DeveloperError on undefined, unmounting the whole globe.
        expect(isRenderableEntity(at(undefined, undefined))).toBe(false);
        expect(isRenderableEntity(at(51.5, undefined))).toBe(false);
        expect(isRenderableEntity(at(undefined, -0.12))).toBe(false);
    });

    it("rejects non-numeric, NaN and infinite values", () => {
        expect(isRenderableEntity(at("51.5", "-0.12"))).toBe(false);
        expect(isRenderableEntity(at(null, null))).toBe(false);
        expect(isRenderableEntity(at(NaN, 0))).toBe(false);
        expect(isRenderableEntity(at(0, Infinity))).toBe(false);
    });

    it("rejects out-of-range coordinates", () => {
        expect(isRenderableEntity(at(91, 0))).toBe(false);
        expect(isRenderableEntity(at(0, 181))).toBe(false);
    });

    it("rejects a missing entity", () => {
        expect(isRenderableEntity(null)).toBe(false);
        expect(isRenderableEntity(undefined)).toBe(false);
    });
});

describe("partitionRenderable", () => {
    it("returns the original array untouched when everything is valid", () => {
        const input = [at(1, 2), at(3, 4)];
        const { valid, dropped } = partitionRenderable(input);
        expect(dropped).toBe(0);
        // Same reference: the common path must not allocate.
        expect(valid).toBe(input);
    });

    it("keeps the good entities and counts the bad", () => {
        const { valid, dropped } = partitionRenderable([
            at(1, 2),
            at(undefined, undefined),
            at(3, 4),
            at(NaN, 5),
        ]);
        expect(dropped).toBe(2);
        expect(valid.map((e) => e.latitude)).toEqual([1, 3]);
    });

    it("handles the real aviation payload-envelope bug", () => {
        // The bundle's mapper hit Object.values({source, fetchedAt, items,
        // totalCount}) and mapped the four envelope values, producing entities
        // whose lat/lon came from a string, a string, an array and a number.
        const envelopeRows = ["aviation", "2026-09-26T03:27:30.187Z", [], 6545];
        const garbage = envelopeRows.map((row) =>
            at((row as { lat?: number }).lat, (row as { lon?: number }).lon),
        );
        const { valid, dropped } = partitionRenderable([...garbage, at(51.5, -0.12)]);
        expect(dropped).toBe(4);
        expect(valid).toHaveLength(1);
    });

    it("handles an empty batch", () => {
        expect(partitionRenderable([])).toEqual({ valid: [], dropped: 0 });
    });
});
