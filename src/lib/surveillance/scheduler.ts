/**
 * In-process scheduler for the surveillance-infrastructure sweep.
 *
 * The sweep would normally live in a data-engine seeder, but an instance can
 * run with `engine: false` and still have Redis, leaving the seeder nowhere to
 * execute. Rather than expose an HTTP trigger — which would mean punching a
 * hole in the deny-by-default API gate in `proxy.ts` — the app schedules the
 * sweep itself.
 *
 * Staleness-driven, not boot-driven: every tick asks "is the cached data older
 * than the refresh interval?" rather than "has six hours passed since boot".
 * A restart therefore never costs a redundant global Overpass sweep, and a
 * container that restarts frequently does not hammer a shared public service.
 *
 * Concurrency across `pm2 -i 4` workers is handled by the atomic Redis lock in
 * `runSweep`, so all four may tick freely; exactly one will do the work.
 */

import { redis } from "@/lib/redis";

import { KEY_PREFIX } from "./regions";
import { runSweep } from "./sweep";

/** Refresh cadence. OSM moves slowly and Overpass is shared infrastructure. */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How often to re-check staleness. Cheap: one Redis GET. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/**
 * Delay before the first check, so four workers booting together do not all
 * reach Redis in the same millisecond. Jittered per process.
 */
const INITIAL_DELAY_MS = 20_000;
const JITTER_MS = 40_000;

let started = false;

function isEnabled(): boolean {
    // Opt out entirely (e.g. a dev machine that should not sweep).
    if (process.env.SURVEILLANCE_AUTO_SWEEP === "0") return false;
    // Never sweep during `next build`, which also evaluates instrumentation.
    if (process.env.NEXT_PHASE === "phase-production-build") return false;
    return true;
}

/** Age of the cached data in ms, or null when there is none. */
async function cacheAgeMs(): Promise<number | null> {
    try {
        const raw = await redis.get(`${KEY_PREFIX}:index`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { fetchedAt?: string };
        if (!parsed.fetchedAt) return null;
        const age = Date.now() - new Date(parsed.fetchedAt).getTime();
        return Number.isFinite(age) ? age : null;
    } catch {
        // Unreadable cache is treated as absent; the sweep will rewrite it.
        return null;
    }
}

export async function isStale(): Promise<boolean> {
    const age = await cacheAgeMs();
    return age === null || age >= REFRESH_INTERVAL_MS;
}

async function tick(): Promise<void> {
    try {
        if (!(await isStale())) return;
        const result = await runSweep();
        if (result) {
            console.log(
                `[surveillance-scheduler] refreshed: ${result.total} devices ` +
                    `across ${result.regions} regions`,
            );
        }
    } catch (err) {
        // Never throw out of a timer — an unhandled rejection here would take
        // the worker down over a transient Overpass outage.
        console.error(
            "[surveillance-scheduler] sweep failed, keeping previous cache:",
            err instanceof Error ? err.message : err,
        );
    }
}

/**
 * Starts the scheduler. Safe to call more than once per process; only the
 * first call takes effect.
 */
export function startSurveillanceScheduler(): void {
    if (started || !isEnabled()) return;
    started = true;

    const firstDelay = INITIAL_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
    console.log(
        `[surveillance-scheduler] enabled — first check in ${Math.round(firstDelay / 1000)}s, ` +
            `then every ${CHECK_INTERVAL_MS / 60_000}m (refresh when older than ` +
            `${REFRESH_INTERVAL_MS / 3_600_000}h)`,
    );

    // unref() so a pending timer never holds the process open during shutdown.
    setTimeout(() => {
        void tick();
        setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
    }, firstDelay).unref();
}
