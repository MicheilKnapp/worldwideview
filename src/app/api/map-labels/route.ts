import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";
import { getClientIp, mapLabelsLimiter } from "@/lib/rateLimiters";
import { fetchPlaces } from "@/lib/mapLabels/fetchPlaces";
import { parseBbox } from "@/lib/surveillance/regions";
import { tileBbox, tileCacheKey, tilesForBbox } from "@/lib/mapLabels/tiles";
import type { PlaceLabel } from "@/lib/mapLabels/places";

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

/**
 * Circuit breaker for upstream failures.
 *
 * When Overpass starts refusing us — throttling, or simply being down — the
 * worst response is to keep asking. Continuing to hammer a service that is
 * already rejecting requests is what earns a longer block, and every attempt
 * costs the visitor a slow request that returns nothing anyway.
 *
 * One tile failure opens the breaker: cached tiles keep serving, uncached ones
 * come back empty, and nothing reaches Overpass until it closes.
 */
const BREAKER_KEY = "map-labels:upstream-cooldown";
const BREAKER_SECONDS = 15 * 60;

async function breakerOpen(): Promise<boolean> {
    try {
        return (await redis.get(BREAKER_KEY)) !== null;
    } catch {
        // Cannot tell — allow the attempt rather than silently disabling labels.
        return false;
    }
}

async function openBreaker(): Promise<void> {
    try {
        await redis.set(BREAKER_KEY, String(Date.now()), "EX", BREAKER_SECONDS);
        console.warn(
            `[map-labels] upstream failing — pausing Overpass calls for ${BREAKER_SECONDS / 60} minutes`,
        );
    } catch {
        // Without Redis the breaker cannot latch; the rate limiter still applies.
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

    // Serve whole grid tiles rather than the exact view. Caching the view
    // itself meant every pan and zoom minted a new key and a new upstream
    // query — hundreds of Overpass requests from a single browsing session.
    const tiles = tilesForBbox(bbox);
    const places: PlaceLabel[] = [];
    const seen = new Set<string>();
    let degraded = false;
    let served = 0;
    // Checked once per request, not per tile: within one view the answer
    // cannot meaningfully change, and re-reading it four times is waste.
    let skipUpstream = await breakerOpen();

    for (const tile of tiles) {
        const key = tileCacheKey(tile);
        let tilePlaces: PlaceLabel[] | null = null;

        try {
            const cached = await redis.get(key);
            if (cached) {
                tilePlaces = JSON.parse(cached) as PlaceLabel[];
                served++;
            }
        } catch (err) {
            // A cache miss must never be fatal; fall through to Overpass.
            console.warn("[map-labels] cache read failed:", err);
        }

        if (!tilePlaces && skipUpstream) {
            // Breaker is open: serve what is cached, leave the rest blank.
            degraded = true;
            continue;
        }

        if (!tilePlaces) {
            try {
                const box = tileBbox(tile);
                tilePlaces = await fetchPlaces({
                    south: box.south,
                    west: box.west,
                    north: box.north,
                    east: box.east,
                });
                try {
                    await redis.set(key, JSON.stringify(tilePlaces), "EX", CACHE_TTL_SECONDS);
                } catch (err) {
                    console.warn("[map-labels] cache write failed:", err);
                }
            } catch (err) {
                // Labels are decoration. A tile that cannot be fetched is
                // skipped rather than failing the whole view, and the client
                // is told so it does not treat an empty area as authoritative.
                console.error(
                    "[map-labels] tile fetch failed:",
                    key,
                    err instanceof Error ? err.message : err,
                );
                degraded = true;
                await openBreaker();
                skipUpstream = true;
                continue;
            }
        }

        for (const place of tilePlaces) {
            if (seen.has(place.id)) continue;
            seen.add(place.id);
            places.push(place);
        }
    }

    return NextResponse.json({
        places,
        tiles: tiles.length,
        cachedTiles: served,
        degraded,
    });
}
