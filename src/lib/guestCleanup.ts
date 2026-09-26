import { prisma } from "@/lib/db";
import { acquireLock, releaseLock } from "@/lib/redisLock";

/**
 * Deletes expired guest accounts.
 *
 * "Continue as Guest" creates a real but temporary user so that favourites,
 * settings and layer access work normally. Those records are only ever meant to
 * live as long as their session, and the Privacy Policy says so — but nothing
 * removed them: `pnpm cleanup:guests` existed as a manual script and was not
 * scheduled anywhere, so guest rows accumulated indefinitely.
 *
 * Everything attached to a guest (sessions, accounts, favourites, API keys)
 * cascade-deletes with the user.
 */

const LOCK_KEY = "lock:guest-cleanup";
const LOCK_TTL_SECONDS = 10 * 60;
/** Daily. Guest sessions last seven days, so there is no value in going faster. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Stagger the first run so four workers do not all hit Redis at once. */
const INITIAL_DELAY_MS = 60_000;
const JITTER_MS = 60_000;

let started = false;

/**
 * Removes guest accounts whose every session has expired.
 * @returns the number deleted, or null when another worker holds the lock.
 */
export async function deleteStaleGuests(): Promise<number | null> {
    if (!(await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS))) return null;
    try {
        // `every` is true for a guest with no sessions at all, which is exactly
        // the abandoned-signup case and should also be cleaned up.
        const stale = await prisma.betterAuthUser.findMany({
            where: {
                isAnonymous: true,
                sessions: { every: { expiresAt: { lt: new Date() } } },
            },
            select: { id: true },
        });
        if (stale.length === 0) return 0;

        const { count } = await prisma.betterAuthUser.deleteMany({
            where: { id: { in: stale.map((u) => u.id) } },
        });
        console.log(`[guestCleanup] removed ${count} expired guest account(s)`);
        return count;
    } finally {
        await releaseLock(LOCK_KEY);
    }
}

function isEnabled(): boolean {
    if (process.env.GUEST_CLEANUP === "0") return false;
    // instrumentation also runs during `next build`.
    if (process.env.NEXT_PHASE === "phase-production-build") return false;
    return true;
}

/** Starts the daily sweep. Safe to call more than once per process. */
export function startGuestCleanupScheduler(): void {
    if (started || !isEnabled()) return;
    started = true;

    const run = async () => {
        try {
            await deleteStaleGuests();
        } catch (err) {
            // Never throw out of a timer: an unhandled rejection here would take
            // the worker down over a transient database blip.
            console.error(
                "[guestCleanup] sweep failed:",
                err instanceof Error ? err.message : err,
            );
        }
    };

    const firstDelay = INITIAL_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
    console.log(`[guestCleanup] enabled — first run in ${Math.round(firstDelay / 1000)}s, then daily`);

    setTimeout(() => {
        void run();
        setInterval(() => void run(), INTERVAL_MS).unref();
    }, firstDelay).unref();
}
