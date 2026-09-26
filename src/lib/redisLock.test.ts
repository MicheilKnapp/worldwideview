import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plain functions rather than vi.fn: vitest records a mock's thrown result in
 * mock.results, where nothing awaits it, and reports that as an unhandled
 * error — failing the test even though the code under test catches it. Calls
 * are recorded by hand so the failure paths stay testable.
 *
 * vi.hoisted because vi.mock is lifted above ordinary declarations.
 */
const h = vi.hoisted(() => ({
    calls: { set: [] as unknown[][], del: [] as unknown[][] },
    impl: {
        set: async (): Promise<unknown> => "OK",
        get: async (): Promise<unknown> => null,
        del: async (): Promise<unknown> => 1,
    },
}));

vi.mock("@/lib/redis", () => ({
    redis: {
        set: (...args: unknown[]) => {
            h.calls.set.push(args);
            return h.impl.set();
        },
        get: () => h.impl.get(),
        del: (...args: unknown[]) => {
            h.calls.del.push(args);
            return h.impl.del();
        },
    },
}));

import { acquireLock, isLockHeld, releaseLock } from "./redisLock";

beforeEach(() => {
    h.calls.set = [];
    h.calls.del = [];
    h.impl.set = async () => "OK";
    h.impl.get = async () => null;
    h.impl.del = async () => 1;
});

describe("acquireLock", () => {
    it("acquires with SET NX EX so four pm2 workers cannot all win", async () => {
        await expect(acquireLock("lock:x", 600)).resolves.toBe(true);
        // NX is the whole point: a get-then-set race would let every worker
        // observe an unheld lock and run the same job simultaneously.
        const [key, , ex, ttl, nx] = h.calls.set[0];
        expect(key).toBe("lock:x");
        expect(ex).toBe("EX");
        expect(ttl).toBe(600);
        expect(nx).toBe("NX");
    });

    it("does not acquire when another process holds it", async () => {
        h.impl.set = async () => null;
        await expect(acquireLock("lock:x", 600)).resolves.toBe(false);
    });

    it("does not acquire when Redis is unreachable", async () => {
        // Nobody can coordinate, so nobody should run.
        h.impl.set = async () => {
            throw new Error("ECONNREFUSED");
        };
        await expect(acquireLock("lock:x", 600)).resolves.toBe(false);
    });
});

describe("releaseLock", () => {
    it("deletes the key", async () => {
        await releaseLock("lock:x");
        expect(h.calls.del[0][0]).toBe("lock:x");
    });

    it("swallows failures, since the TTL clears the lock anyway", async () => {
        h.impl.del = async () => {
            throw new Error("nope");
        };
        await expect(releaseLock("lock:x")).resolves.toBeUndefined();
    });
});

describe("isLockHeld", () => {
    it("reports held and free", async () => {
        h.impl.get = async () => "1234";
        await expect(isLockHeld("lock:x")).resolves.toBe(true);
        h.impl.get = async () => null;
        await expect(isLockHeld("lock:x")).resolves.toBe(false);
    });

    it("reports free when Redis is unreachable", async () => {
        h.impl.get = async () => {
            throw new Error("down");
        };
        await expect(isLockHeld("lock:x")).resolves.toBe(false);
    });
});
