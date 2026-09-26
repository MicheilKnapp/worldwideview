import Redis from "ioredis";

// Narrow interface covering only the commands this app uses directly.
// Exporting this type (rather than the full Redis class) keeps test mocks simple.
export interface RedisMultiChain {
    lrange(key: string, start: number, stop: number): this;
    del(key: string): this;
    rpush(key: string, ...values: string[]): this;
    expire(key: string, seconds: number): this;
    set(key: string, value: string, exFlag: "EX", ttlSeconds: number): this;
    exec(): Promise<Array<[Error | null, unknown]>>;
}

export interface RedisClient {
    ping(): Promise<string>;
    set(key: string, value: string, exFlag: "EX", ttlSeconds: number): Promise<string | null>;
    /**
     * SET ... EX ttl NX — resolves to "OK" when the key was absent and this
     * caller won it, or null when someone else holds it. Atomic, so it is
     * safe as a cross-process lock (a read-then-write is not: every pm2
     * worker can observe "free" before any of them writes).
     */
    set(key: string, value: string, exFlag: "EX", ttlSeconds: number, nxFlag: "NX"): Promise<string | null>;
    del(key: string): Promise<number>;
    get(key: string): Promise<string | null>;
    zadd(key: string, score: number, member: string): Promise<number>;
    zrange(key: string, start: number | string, stop: number | string, withScores: "WITHSCORES"): Promise<string[]>;
    zrem(key: string, ...members: string[]): Promise<number>;
    zremrangebyscore(key: string, min: number | "-inf", max: number | "+inf"): Promise<number>;
    zcard(key: string): Promise<number>;
    rpush(key: string, ...values: string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    multi(): RedisMultiChain;
}

const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 50, 2000);
    },
    maxRetriesPerRequest: 3,
    lazyConnect: true,
});

// Graceful degrade: connectivity issues are logged but never thrown.
client.on("error", (err) => {
    console.warn("[Redis] connection error:", err);
});

export const redis: RedisClient = client as unknown as RedisClient;
