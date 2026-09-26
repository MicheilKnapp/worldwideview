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
import { acquireLock, isLockHeld, releaseLock } from "@/lib/redisLock";

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
/**
 * A tier must return at least this fraction of its previous count to be
 * believed. Real-world churn between sweeps is a fraction of a percent; a
 * drop past this means the mirror is wrong, not the world.
 */
const PLAUSIBLE_FRACTION = 0.6;

/** Per-tier counts from the last good sweep, or {} if there is none. */
async function previousCounts(): Promise<Record<string, number>> {
    try {
        const raw = await redis.get(`${KEY_PREFIX}:index`);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as { counts?: Record<string, number> };
        return parsed.counts ?? {};
    } catch {
        return {};
    }
}

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
        return await isLockHeld(LOCK_KEY);
    } catch {
        return false;
    }
}

/**
 * Runs a sweep, unless another process is already doing so.
 * @returns the result, or null when the lock was held elsewhere.
 */
export async function runSweep(): Promise<SweepResult | null> {
    if (!(await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS))) {
        console.log("[surveillance-sweep] another process holds the lock — skipping");
        return null;
    }
    try {
        const batches: DeviceRecord[][] = [];
        const succeeded: string[] = [];
        const degraded: string[] = [];

        // Smallest tiers first: if the big ALPR sweep exhausts every mirror, we
        // still publish the cheap ones rather than losing the whole run.
        // Floors derived from the last good sweep: ground truth for this
        // deployment, and the only way to notice a mirror serving a stale
        // planet extract (it answers 200 with valid JSON and a fraction of
        // the rows).
        const previous = await previousCounts();

        const tiers = [...enabledTiers()].sort((a, b) => a.approxCount - b.approxCount);
        for (const tier of tiers) {
            const prior = previous[tier.id] ?? 0;
            const floor = prior > 0 ? Math.floor(prior * PLAUSIBLE_FRACTION) : 0;
            try {
                const result = await fetchTier(tier, floor);
                if (result.implausible) {
                    degraded.push(tier.id);
                    continue;
                }
                batches.push(
                    result.elements
                        .map((el) => toRecord(el, tier.id))
                        .filter((r): r is DeviceRecord => r !== null),
                );
                succeeded.push(tier.id);
            } catch (err) {
                degraded.push(tier.id);
                console.error(
                    `[surveillance-sweep] tier "${tier.id}" failed:`,
                    err instanceof Error ? err.message : err,
                );
            }
        }

        // All or nothing. Region tiles are whole-tile replacements built from
        // whatever succeeded, so writing after a partial failure DELETES the
        // missing tier's devices rather than preserving them. Leaving the
        // previous cache intact and retrying on the next tick is the only way
        // "keep what we had" is actually true.
        if (degraded.length > 0) {
            throw new Error(
                `tiers [${degraded.join(", ")}] failed or returned implausible counts — ` +
                    `cache left untouched (a partial write would drop them)`,
            );
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
        await releaseLock(LOCK_KEY);
    }
}
