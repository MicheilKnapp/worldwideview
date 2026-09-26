import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A plain function variable rather than `vi.fn()`: when a mock throws or
 * returns a rejected promise, vitest records that outcome in `mock.results`
 * and reports it as an unhandled error, failing the test even though the code
 * under test catches it correctly. Swapping the implementation directly keeps
 * the failure paths testable.
 */
let getImpl: (key: string) => Promise<string | null> = async () => null;

vi.mock("@/lib/redis", () => ({ redis: { get: (key: string) => getImpl(key) } }));

import { isStale } from "./scheduler";

const REFRESH_MS = 6 * 60 * 60 * 1000;
const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
const returns = (value: string | null) => {
    getImpl = async () => value;
};

describe("isStale", () => {
    beforeEach(() => returns(null));

    it("is stale when nothing is cached yet", async () => {
        returns(null);
        expect(await isStale()).toBe(true);
    });

    it("is fresh just inside the refresh window", async () => {
        returns(JSON.stringify({ fetchedAt: agoIso(REFRESH_MS - 60_000) }));
        expect(await isStale()).toBe(false);
    });

    it("is stale once past the refresh window", async () => {
        returns(JSON.stringify({ fetchedAt: agoIso(REFRESH_MS + 60_000) }));
        expect(await isStale()).toBe(true);
    });

    it("treats malformed cache as stale rather than throwing", async () => {
        returns("not json");
        expect(await isStale()).toBe(true);

        returns(JSON.stringify({ fetchedAt: "nonsense-date" }));
        expect(await isStale()).toBe(true);

        returns(JSON.stringify({ total: 5 }));
        expect(await isStale()).toBe(true);
    });

    it("treats a Redis outage as stale without propagating the error", async () => {
        // Attempting a sweep is safe (the lock arbitrates) and far better than
        // letting a rejection escape into a timer and take the worker down.
        getImpl = async () => {
            throw new Error("ECONNREFUSED");
        };
        expect(await isStale()).toBe(true);
    });
});
