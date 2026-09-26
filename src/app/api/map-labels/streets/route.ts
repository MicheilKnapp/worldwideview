import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";
import { getClientIp, mapLabelsLimiter } from "@/lib/rateLimiters";
import { fetchStreets } from "@/lib/mapLabels/fetchStreets";
import { streetTileCacheKey, streetTilesForBbox, tileBbox } from "@/lib/mapLabels/tiles";
import type { StreetWay } from "@/lib/mapLabels/streets";
import { parseBbox } from "@/lib/surveillance/regions";

/**
 * Named road geometry for a viewport, for labels drawn along streets.
 *
 * Separate from the place-label route because the data is much heavier and the
 * caching is tuned differently: `out geom` returns every coordinate of every
 * way, so tiles are small and only requested at close zoom.
 */

/** Road geometry changes slowly. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Shared with the place route: stop asking a service that is refusing us. */
const BREAKER_KEY = "map-labels:upstream-cooldown";
const BREAKER_SECONDS = 15 * 60;

async function breakerOpen(): Promise<boolean> {
    try {
        return (await redis.get(BREAKER_KEY)) !== null;
    } catch {
        return false;
    }
}

export async function GET(request: Request) {
    const rateLimited = mapLabelsLimiter.check(getClientIp(request));
    if (rateLimited) return rateLimited;

    const bbox = parseBbox(new URL(request.url).searchParams.get("bbox"));
    if (!bbox) {
        return NextResponse.json(
            { error: "Invalid bbox", detail: "Expected bbox=west,south,east,north in degrees." },
            { status: 400 },
        );
    }

    const tiles = streetTilesForBbox(bbox);
    const ways: StreetWay[] = [];
    const seen = new Set<string>();
    let degraded = false;
    let skipUpstream = await breakerOpen();

    for (const tile of tiles) {
        const key = streetTileCacheKey(tile);
        let tileWays: StreetWay[] | null = null;

        try {
            const cached = await redis.get(key);
            if (cached) tileWays = JSON.parse(cached) as StreetWay[];
        } catch (err) {
            console.warn("[map-labels/streets] cache read failed:", err);
        }

        if (!tileWays && skipUpstream) {
            degraded = true;
            continue;
        }

        if (!tileWays) {
            try {
                tileWays = await fetchStreets(tileBbox(tile));
                try {
                    await redis.set(key, JSON.stringify(tileWays), "EX", CACHE_TTL_SECONDS);
                } catch (err) {
                    console.warn("[map-labels/streets] cache write failed:", err);
                }
            } catch (err) {
                console.error(
                    "[map-labels/streets] tile fetch failed:",
                    key,
                    err instanceof Error ? err.message : err,
                );
                degraded = true;
                skipUpstream = true;
                try {
                    await redis.set(BREAKER_KEY, String(Date.now()), "EX", BREAKER_SECONDS);
                } catch {
                    // Without Redis the breaker cannot latch; the limiter still applies.
                }
                continue;
            }
        }

        for (const way of tileWays) {
            if (seen.has(way.id)) continue;
            seen.add(way.id);
            ways.push(way);
        }
    }

    return NextResponse.json({ ways, tiles: tiles.length, degraded });
}
