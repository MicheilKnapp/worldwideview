import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";
import { getClientIp, mapLabelsLimiter } from "@/lib/rateLimiters";
import { fetchPlaces } from "@/lib/mapLabels/fetchPlaces";
import { parseBbox } from "@/lib/surveillance/regions";

/**
 * Place names for a viewport, for labels drawn above the 3D tiles.
 *
 * Proxied and cached rather than queried from the browser: Overpass is shared
 * volunteer infrastructure, and one request per camera move per visitor would
 * be abusive. Results are keyed by a coarsened bbox so neighbouring views share
 * a cache entry instead of each cutting a new one.
 */

/** OSM place names change on the order of years, so cache hard. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Snap the bbox to this grid for the cache key. */
const KEY_PRECISION_DEG = 0.25;

function cacheKey(west: number, south: number, east: number, north: number): string {
    const snap = (v: number) => (Math.round(v / KEY_PRECISION_DEG) * KEY_PRECISION_DEG).toFixed(2);
    return `map-labels:places:${snap(west)}:${snap(south)}:${snap(east)}:${snap(north)}`;
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

    const key = cacheKey(bbox.west, bbox.south, bbox.east, bbox.north);
    try {
        const cached = await redis.get(key);
        if (cached) {
            return NextResponse.json({ places: JSON.parse(cached), cached: true });
        }
    } catch (err) {
        // A cache miss must never be fatal; fall through to Overpass.
        console.warn("[map-labels] cache read failed:", err);
    }

    try {
        const places = await fetchPlaces({
            south: bbox.south,
            west: bbox.west,
            north: bbox.north,
            east: bbox.east,
        });
        try {
            await redis.set(key, JSON.stringify(places), "EX", CACHE_TTL_SECONDS);
        } catch (err) {
            console.warn("[map-labels] cache write failed:", err);
        }
        return NextResponse.json({ places, cached: false });
    } catch (err) {
        console.error("[map-labels] Overpass failed:", err instanceof Error ? err.message : err);
        // Labels are decoration: an empty list degrades the map, it does not
        // break it, so this is a 200 rather than an error the client must handle.
        return NextResponse.json({ places: [], cached: false, degraded: true });
    }
}
