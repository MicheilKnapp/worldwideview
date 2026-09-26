import { redis } from "@/lib/redis";

/**
 * Cross-process mutex for scheduled work.
 *
 * The app runs under `pm2 -i 4`, so every scheduled job starts in four workers
 * at once. Acquisition must be atomic (SET NX): a read-then-write race lets all
 * four observe an unheld lock and do the same work simultaneously.
 *
 * The TTL is the safety net — a worker killed mid-job cannot wedge the lock
 * permanently, it simply expires.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    try {
        return (await redis.set(key, String(process.pid), "EX", ttlSeconds, "NX")) === "OK";
    } catch (err) {
        // Unreachable Redis means nobody can coordinate, so nobody should run.
        console.warn(`[redisLock] could not acquire "${key}":`, err);
        return false;
    }
}

export async function releaseLock(key: string): Promise<void> {
    try {
        await redis.del(key);
    } catch {
        // The TTL clears it regardless; worst case is a delayed next run.
    }
}

export async function isLockHeld(key: string): Promise<boolean> {
    try {
        return (await redis.get(key)) !== null;
    } catch {
        return false;
    }
}
