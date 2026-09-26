import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";
import { getClientIp, surveillanceLimiter } from "@/lib/rateLimiters";
import {
    ATTRIBUTION,
    KEY_PREFIX,
    parseBbox,
    parseTiers,
    redisKeyForRegion,
    regionsForBbox,
    withinBbox,
    type DeviceRecord,
    type RegionPayload,
    type TierId,
} from "@/lib/surveillance/regions";

/**
 * Serves the surveillance-infrastructure layer from the seeder's Redis cache.
 *
 *   GET ?bbox=west,south,east,north[&tiers=alpr,afr]  -> devices in view
 *   GET (no bbox)                                     -> global cluster summary
 *
 * The full dataset is ~157k devices, so detail is only ever served for a
 * bounded viewport. This route never calls Overpass itself — the seeder owns
 * that, and a global sweep from a request handler would take minutes.
 */

/** Hard ceiling on one response, independent of how large a bbox is asked for. */
const MAX_DEVICES = 20_000;

interface IndexPayload {
    fetchedAt: string;
    regions: string[];
    counts: Record<string, number>;
    total: number;
    tiers: string[];
    degradedTiers: string[];
}

function attributed(body: Record<string, unknown>, init?: ResponseInit) {
    const res = NextResponse.json({ ...body, attribution: ATTRIBUTION }, init);
    // ODbL requires the licence to travel with the data, not just the UI.
    res.headers.set("X-Data-Source", "OpenStreetMap");
    res.headers.set("X-Data-License", "ODbL-1.0");
    res.headers.set("Link", `<${ATTRIBUTION.licenseUrl}>; rel="license"`);
    return res;
}

async function readJson<T>(key: string): Promise<T | null> {
    try {
        const raw = await redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
        console.warn(`[surveillance-infrastructure] redis read failed for ${key}:`, err);
        return null;
    }
}

const COLD_CACHE = {
    error: "Surveillance cache is empty",
    detail:
        "The surveillance-infrastructure seeder has not completed a sweep yet. " +
        "It runs every six hours; data appears after the first successful run.",
};

export async function GET(request: Request) {
    const rateLimited = surveillanceLimiter.check(getClientIp(request));
    if (rateLimited) return rateLimited;

    const url = new URL(request.url);
    const index = await readJson<IndexPayload>(`${KEY_PREFIX}:index`);
    if (!index) {
        return attributed(COLD_CACHE, { status: 503, headers: { "Retry-After": "600" } });
    }

    const rawBbox = url.searchParams.get("bbox");

    // No bbox — hand back the global summary so the globe can draw something
    // before any tile is fetched.
    if (!rawBbox) {
        const live = await readJson<{ summary?: unknown[] }>(`${KEY_PREFIX}:live`);
        return attributed({
            mode: "summary",
            fetchedAt: index.fetchedAt,
            total: index.total,
            counts: index.counts,
            degradedTiers: index.degradedTiers,
            summary: live?.summary ?? [],
        });
    }

    const bbox = parseBbox(rawBbox);
    if (!bbox) {
        return attributed(
            { error: "Invalid bbox", detail: "Expected bbox=west,south,east,north in degrees." },
            { status: 400 },
        );
    }

    const tierFilter = parseTiers(url.searchParams.get("tiers"));
    const wanted = tierFilter ? new Set<TierId>(tierFilter) : null;

    const regionKeys = regionsForBbox(bbox);
    const payloads = await Promise.all(
        regionKeys.map((key) => readJson<RegionPayload>(redisKeyForRegion(key))),
    );

    const devices: DeviceRecord[] = [];
    let truncated = false;

    outer: for (const payload of payloads) {
        if (!payload?.devices) continue;
        for (const device of payload.devices) {
            if (wanted && !wanted.has(device.t)) continue;
            if (!withinBbox(device, bbox)) continue;
            if (devices.length >= MAX_DEVICES) {
                truncated = true;
                break outer;
            }
            devices.push(device);
        }
    }

    return attributed({
        mode: "detail",
        fetchedAt: index.fetchedAt,
        regions: regionKeys,
        degradedTiers: index.degradedTiers,
        count: devices.length,
        truncated,
        devices,
    });
}
