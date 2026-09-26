/**
 * The Overpass sweep that fills the surveillance-infrastructure cache.
 *
 * This normally belongs in a data-engine seeder, but the engine is optional
 * (a self-hosted instance can run with `engine: false` and still have Redis),
 * so the sweep lives in the app where it is guaranteed to have a runtime. The
 * seeder package mirrors this logic for instances that do run the engine; both
 * write the identical key layout, so only one of them needs to be active.
 */

import { redis } from "@/lib/redis";

import { fetchTier } from "./overpass";
import { mergeByPriority, toRecord } from "./normalize";
import {
    ATTRIBUTION,
    KEY_PREFIX,
    buildSummary,
    countByTier,
    segmentIntoRegions,
    type DeviceRecord,
} from "./regions";
import { enabledTiers } from "./tiers";

/** Long enough that two consecutive failed sweeps cannot blank the layer. */
const TTL_SECONDS = 48 * 60 * 60;
/** Guards against a second trigger piling onto a sweep already in flight. */
const LOCK_TTL_SECONDS = 60 * 60;
const LOCK_KEY = `${KEY_PREFIX}:lock`;

export interface SweepResult {
    fetchedAt: string;
    total: number;
    regions: number;
    summaryCells: number;
    counts: Record<string, number>;
    tiers: string[];
    degradedTiers: string[];
}

export async function isSweepRunning(): Promise<boolean> {
    try {
        return (await redis.get(LOCK_KEY)) !== null;
    } catch {
        return false;
    }
}

/**
 * Takes the sweep lock, or returns false if another process holds it.
 *
 * Atomic (SET NX) rather than get-then-set: the app runs under `pm2 -i 4`, so
 * four workers boot at once and a read-then-write race would let all four
 * start the same global Overpass sweep.
 */
async function acquireLock(): Promise<boolean> {
    try {
        return (await redis.set(LOCK_KEY, String(process.pid), "EX", LOCK_TTL_SECONDS, "NX")) === "OK";
    } catch (err) {
        console.warn("[surveillance-sweep] could not reach Redis for the lock:", err);
        return false;
    }
}

async function releaseLock(): Promise<void> {
    try {
        await redis.del(LOCK_KEY);
    } catch {
        // The TTL clears it regardless; worst case is a delayed next sweep.
    }
}

/**
 * Runs a sweep, unless another process is already doing so.
 * @returns the result, or null when the lock was held elsewhere.
 */
export async function runSweep(): Promise<SweepResult | null> {
    if (!(await acquireLock())) {
        console.log("[surveillance-sweep] another process holds the lock — skipping");
        return null;
    }
    try {
        const batches: DeviceRecord[][] = [];
        const succeeded: string[] = [];
        const degraded: string[] = [];

        // Smallest tiers first: if the big ALPR sweep exhausts every mirror, we
        // still publish the cheap ones rather than losing the whole run.
        const tiers = [...enabledTiers()].sort((a, b) => a.approxCount - b.approxCount);
        for (const tier of tiers) {
            try {
                const elements = await fetchTier(tier);
                batches.push(
                    elements
                        .map((el) => toRecord(el, tier.id))
                        .filter((r): r is DeviceRecord => r !== null),
                );
                succeeded.push(tier.id);
            } catch (err) {
                degraded.push(tier.id);
                console.error(
                    `[surveillance-sweep] tier "${tier.id}" failed, keeping its previous data:`,
                    err instanceof Error ? err.message : err,
                );
            }
        }

        if (succeeded.length === 0) {
            // Writing now would replace a good cache with nothing.
            throw new Error("every tier failed — cache left untouched");
        }

        const devices = mergeByPriority(batches);
        const regions = segmentIntoRegions(devices);
        const summary = buildSummary(devices);
        const fetchedAt = new Date().toISOString();

        // One transaction: a half-written grid would render as holes in the map.
        const tx = redis.multi();
        for (const [key, records] of regions) {
            const [lat, lon] = key.split("/");
            tx.set(
                `${KEY_PREFIX}:region:${lat}:${lon}`,
                JSON.stringify({ fetchedAt, devices: records }),
                "EX",
                TTL_SECONDS,
            );
        }
        tx.set(
            `${KEY_PREFIX}:live`,
            JSON.stringify({ source: "surveillance-infrastructure", fetchedAt, summary }),
            "EX",
            TTL_SECONDS,
        );
        tx.set(
            `${KEY_PREFIX}:index`,
            JSON.stringify({
                fetchedAt,
                regions: [...regions.keys()],
                counts: countByTier(devices),
                total: devices.length,
                tiers: succeeded,
                degradedTiers: degraded,
                attribution: ATTRIBUTION,
            }),
            "EX",
            TTL_SECONDS,
        );
        await tx.exec();

        console.log(
            `[surveillance-sweep] ${devices.length} devices, ${regions.size} regions, ` +
                `${summary.length} cells; ok=[${succeeded.join(",")}] ` +
                `degraded=[${degraded.join(",") || "none"}]`,
        );

        return {
            fetchedAt,
            total: devices.length,
            regions: regions.size,
            summaryCells: summary.length,
            counts: countByTier(devices),
            tiers: succeeded,
            degradedTiers: degraded,
        };
    } finally {
        await releaseLock();
    }
}
