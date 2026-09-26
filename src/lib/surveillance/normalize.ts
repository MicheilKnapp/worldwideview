/**
 * Overpass element -> compact cached record.
 *
 * Records are deliberately small: these tiles are fetched by a browser over the
 * wire, and the raw Overpass payload for the ALPR tier alone is tens of MB.
 */

import type { OverpassElement } from "./overpass";
import type { DeviceRecord, TierId } from "./regions";
import { WHITELISTED_TAGS } from "./tiers";

export type { DeviceRecord };

/** Tier precedence when one OSM object matches several queries. */
const TIER_PRIORITY: Record<TierId, number> = {
    alpr: 0,
    gunshot_detector: 1,
    afr: 2,
    public_space: 3,
};

const COMPASS: Record<string, number> = {
    n: 0, nne: 22.5, ne: 45, ene: 67.5,
    e: 90, ese: 112.5, se: 135, sse: 157.5,
    s: 180, ssw: 202.5, sw: 225, wsw: 247.5,
    w: 270, wnw: 292.5, nw: 315, nnw: 337.5,
};

/**
 * Parses a SINGLE OSM direction value into degrees.
 *
 * Handles plain degrees ("165"), compass points ("NE"), and sector ranges
 * ("90-180", midpoint taken). Returns null for relative values like "forward",
 * which cannot be resolved without the parent way's geometry.
 *
 * Use `parseDirections` for the semicolon-separated multi-value form.
 */
export function parseDirection(raw: string | undefined): number | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    if (!value) return null;

    const numeric = Number(value);
    if (Number.isFinite(numeric)) return ((numeric % 360) + 360) % 360;

    const compass = COMPASS[value];
    if (compass !== undefined) return compass;

    const range = value.match(/^(-?[\d.]+)\s*[-–]\s*(-?[\d.]+)$/);
    if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (Number.isFinite(from) && Number.isFinite(to)) {
            // Midpoint along the shorter arc, so 350-10 reads as 0, not 180.
            const delta = (((to - from) % 360) + 540) % 360 - 180;
            return ((from + delta / 2) % 360 + 360) % 360;
        }
    }
    return null;
}

/**
 * Parses an OSM direction tag, which may hold several bearings separated by
 * semicolons — a gantry watching four approaches is `direction=0;90;180;270`.
 * Commas are accepted too, since a handful of mappers use them.
 *
 * Measured against 64,379 direction-tagged nodes in the live US tile, handling
 * the multi-value form lifts parse coverage from 95.3% to ~99.9%. Duplicate
 * bearings within one tag ("0;0") collapse to a single value.
 */
export function parseDirections(raw: string | undefined): number[] {
    if (!raw) return [];
    const seen = new Set<number>();
    // Semicolon is the OSM convention; a few mappers use commas instead.
    for (const part of raw.split(/[;,]/)) {
        const parsed = parseDirection(part);
        if (parsed !== null) seen.add(parsed);
    }
    return [...seen];
}

function pickTags(tags: Record<string, string> | undefined): Record<string, string> {
    if (!tags) return {};
    const out: Record<string, string> = {};
    for (const key of WHITELISTED_TAGS) {
        const value = tags[key];
        if (value) out[key] = value;
    }
    return out;
}

/** Ways and relations carry their position under `center` (from `out center`). */
function coordsOf(el: OverpassElement): { lat: number; lon: number } | null {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
}

export function toRecord(el: OverpassElement, tier: TierId): DeviceRecord | null {
    const coords = coordsOf(el);
    if (!coords) return null;
    const tags = pickTags(el.tags);
    const bearings = parseDirections(tags["camera:direction"] ?? tags.direction);
    const record: DeviceRecord = {
        id: `${el.type}/${el.id}`,
        lat: coords.lat,
        lon: coords.lon,
        t: tier,
        dir: bearings.length > 0 ? bearings[0] : null,
        tags,
    };
    if (bearings.length > 1) record.dirs = bearings;
    return record;
}

/**
 * Merges per-tier results, keeping the highest-priority tier for any object
 * matched more than once (an `ALPR;guard` node appears in the ALPR tier and
 * could also appear in a broader one).
 */
export function mergeByPriority(batches: DeviceRecord[][]): DeviceRecord[] {
    const byId = new Map<string, DeviceRecord>();
    for (const batch of batches) {
        for (const record of batch) {
            const existing = byId.get(record.id);
            if (!existing || TIER_PRIORITY[record.t] < TIER_PRIORITY[existing.t]) {
                byId.set(record.id, record);
            }
        }
    }
    return [...byId.values()];
}
