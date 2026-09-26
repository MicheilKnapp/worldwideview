import { describe, expect, it, vi } from "vitest";

import { waitForTiles } from "./imageryTransition";

describe("waitForTiles", () => {
    it("returns immediately when already loaded", async () => {
        const started = Date.now();
        await expect(waitForTiles({ tilesLoaded: true })).resolves.toBe(true);
        // Must not cost a poll interval: a cached view would visibly flicker.
        expect(Date.now() - started).toBeLessThan(50);
    });

    it("resolves once tiles finish arriving", async () => {
        const target = { tilesLoaded: false };
        setTimeout(() => {
            target.tilesLoaded = true;
        }, 60);
        await expect(waitForTiles(target, 2_000, 20)).resolves.toBe(true);
    });

    it("gives up at the deadline rather than hanging", async () => {
        // A stalled tile fetch must degrade to "switch anyway", never block
        // the transition indefinitely.
        await expect(waitForTiles({ tilesLoaded: false }, 120, 20)).resolves.toBe(false);
    });

    it("bails out if the target is destroyed mid-wait", async () => {
        const isDestroyed = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
        await expect(waitForTiles({ tilesLoaded: false, isDestroyed }, 2_000, 20)).resolves.toBe(
            false,
        );
    });

    it("treats a missing target as not ready", async () => {
        await expect(waitForTiles(null)).resolves.toBe(false);
        await expect(waitForTiles(undefined)).resolves.toBe(false);
    });
});
