import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";
import { getClientIp, mapLabelsLimiter } from "@/lib/rateLimiters";
import { fetchStreets } from "@/lib/mapLabels/fetchStreets";
import { fetchStreetsFromTiles, tilesAvailable } from "@/lib/mapLabels/fetchFromTiles";
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
    const skipUpstream = await breakerOpen();

    /** Resolves one tile from cache, or upstream when allowed. */
    async function loadTile(tile: (typeof tiles)[number]): Promise<{
        ways: StreetWay[];
        failed: boolean;
    }> {
        const key = streetTileCacheKey(tile);

        try {
            const cached = await redis.get(key);
            if (cached) return { ways: JSON.parse(cached) as StreetWay[], failed: false };
        } catch (err) {
            console.warn("[map-labels/streets] cache read failed:", err);
        }

        // Local PMTiles archives when configured; Overpass only as a fallback.
        if (tilesAvailable()) {
            try {
                const ways = await fetchStreetsFromTiles(tileBbox(tile));
                if (ways) {
                    try {
                        await redis.set(key, JSON.stringify(ways), "EX", CACHE_TTL_SECONDS);
                    } catch (err) {
                        console.warn("[map-labels/streets] cache write failed:", err);
                    }
                    return { ways, failed: false };
                }
            } catch (err) {
                console.error(
                    "[map-labels/streets] pmtiles read failed, falling back to Overpass:",
                    err instanceof Error ? err.message : err,
                );
            }
        }

        if (skipUpstream) return { ways: [], failed: true };

        try {
            const ways = await fetchStreets(tileBbox(tile));
            try {
                await redis.set(key, JSON.stringify(ways), "EX", CACHE_TTL_SECONDS);
            } catch (err) {
                console.warn("[map-labels/streets] cache write failed:", err);
            }
            return { ways, failed: false };
        } catch (err) {
            console.error(
                "[map-labels/streets] tile fetch failed:",
                key,
                err instanceof Error ? err.message : err,
            );
            return { ways: [], failed: true };
        }
    }

    // In parallel. Sequentially, a four-tile view waited for each Overpass
    // round trip in turn, so a cold view took four times longer than it needed
    // to — the slow first load.
    const results = await Promise.all(tiles.map(loadTile));

    const ways: StreetWay[] = [];
    const seen = new Set<string>();
    let degraded = false;

    for (const result of results) {
        if (result.failed) degraded = true;
        for (const way of result.ways) {
            if (seen.has(way.id)) continue;
            seen.add(way.id);
            ways.push(way);
        }
    }

    // Latch the breaker once, after the fact, rather than mid-flight: the
    // parallel calls have already been made, and a single shared failure should
    // not be recorded four times.
    if (degraded && !skipUpstream) {
        try {
            await redis.set(BREAKER_KEY, String(Date.now()), "EX", BREAKER_SECONDS);
            console.warn("[map-labels/streets] upstream failing — pausing Overpass calls");
        } catch {
            // Without Redis the breaker cannot latch; the limiter still applies.
        }
    }

    return NextResponse.json({ ways, tiles: tiles.length, degraded });
}
