import { describe, expect, it } from "vitest";

import { SIMPLIFY_TOLERANCE_DEG, simplifyPolyline } from "./simplify";

describe("simplifyPolyline", () => {
    it("collapses a dense straight line to its endpoints", () => {
        const straight = Array.from({ length: 50 }, (_, i): [number, number] => [i * 0.001, 0]);
        expect(simplifyPolyline(straight)).toEqual([[0, 0], [0.049, 0]]);
    });

    it("keeps a corner, which carries the road's direction change", () => {
        const corner: [number, number][] = [[0, 0], [0.01, 0], [0.01, 0.01]];
        expect(simplifyPolyline(corner)).toHaveLength(3);
    });

    it("keeps enough of a curve to aim a label correctly", () => {
        // A quarter circle. Flattening this would tilt text away from the road.
        const curve = Array.from({ length: 40 }, (_, i): [number, number] => {
            const t = (i / 39) * (Math.PI / 2);
            return [Math.cos(t) * 0.01, Math.sin(t) * 0.01];
        });
        const simplified = simplifyPolyline(curve);
        expect(simplified.length).toBeGreaterThan(3);
        expect(simplified.length).toBeLessThan(curve.length);
    });

    it("always preserves the first and last points", () => {
        const coords = Array.from({ length: 30 }, (_, i): [number, number] => [i * 0.0001, 0]);
        const simplified = simplifyPolyline(coords);
        expect(simplified[0]).toEqual(coords[0]);
        expect(simplified[simplified.length - 1]).toEqual(coords[coords.length - 1]);
    });

    it("leaves short lines alone", () => {
        expect(simplifyPolyline([[0, 0], [1, 1]])).toHaveLength(2);
        expect(simplifyPolyline([[0, 0]])).toHaveLength(1);
        expect(simplifyPolyline([])).toHaveLength(0);
    });

    it("returns the input unchanged for a non-positive tolerance", () => {
        const coords: [number, number][] = [[0, 0], [0.001, 0], [0.002, 0]];
        expect(simplifyPolyline(coords, 0)).toHaveLength(3);
    });

    it("handles thousands of points without overflowing the stack", () => {
        // Iterative on purpose: a recursive implementation can blow the stack on
        // a long way, and way length is not under our control.
        const many = Array.from({ length: 20_000 }, (_, i): [number, number] => [
            i * 0.00001,
            Math.sin(i / 50) * 0.0001,
        ]);
        expect(() => simplifyPolyline(many, SIMPLIFY_TOLERANCE_DEG)).not.toThrow();
    });
});
