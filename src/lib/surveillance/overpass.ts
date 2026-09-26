/**
 * Overpass client with mirror failover.
 *
 * The public Overpass instances reject global queries under load — a real
 * response seen during design work was:
 *
 *   runtime error: open64: 0 Success /osm3s_osm_base
 *   Dispatcher_Client::request_read_and_idx::timeout.
 *   The server is probably too busy to handle your request.
 *
 * That arrives as HTTP 200 with an HTML body, so status-code checks alone are
 * not enough — we validate that the payload actually parses as Overpass JSON.
 * Every tier is tried against each mirror in turn before giving up, and callers
 * are expected to keep the last good snapshot rather than blanking the layer.
 */

import type { Tier } from "./tiers";

/**
 * Mirrors in preference order.
 *
 * Ordered by measured planet freshness, not availability: a mirror on a stale
 * extract answers 200 with valid JSON and silently short data. Measured
 * 2026-09-26 via `osm3s.timestamp_osm_base`:
 *
 *   overpass-api.de       current
 *   lz4.overpass-api.de   current (same backend as the main instance)
 *   kumi.systems          returned 102,635 ALPR / 2,039 gunshot against
 *                         154,238 / 3,692 from the main instance
 *   private.coffee        planet base 2026-06-01, ~117 days behind
 *
 * The last two stay listed as genuine fallbacks -- short data beats no data
 * when the fresh mirrors are down -- but only after both fresh ones, and the
 * freshness check below rejects them while anything better is reachable.
 */
export const OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
] as const;

/** Just the shape these helpers read — `process.env` satisfies it, and so
 * does a plain object in tests. */
type EnvLike = Record<string, string | undefined>;

/**
 * Mirror order for one run, most-preferred first.
 *
 * `SURVEILLANCE_OVERPASS_MIRRORS` (comma-separated) overrides the built-in
 * list, so an operator can point at their own Overpass instance or prefer a
 * higher-capacity mirror over the busy main endpoint. Entries must be http(s)
 * URLs; anything else is ignored, and an override that leaves nothing valid
 * falls back to the defaults rather than failing every tier.
 */
export function overpassMirrors(env: EnvLike = process.env): string[] {
    const raw = env.SURVEILLANCE_OVERPASS_MIRRORS;
    if (!raw) return [...OVERPASS_MIRRORS];
    const custom = raw
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.startsWith("http://") || m.startsWith("https://"));
    return custom.length > 0 ? custom : [...OVERPASS_MIRRORS];
}

/** Overpass server-side budget. Global sweeps genuinely need minutes. */
const QUERY_TIMEOUT_SEC = 600;
/** Client-side ceiling, a little above the server budget. */
const REQUEST_TIMEOUT_MS = 660_000;
/**
 * Reject a mirror whose planet extract is older than this.
 *
 * Every Overpass response carries `osm3s.timestamp_osm_base`, the planet
 * snapshot it answered from. Checking it catches a stale mirror on the very
 * first query, with no history to compare against -- unlike the element-count
 * floor, which needs a previous successful sweep. A healthy mirror is minutes
 * behind; a week is generous headroom for one catching up.
 */
const MAX_PLANET_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Pause between mirrors so a struggling instance is not hammered. */
const MIRROR_BACKOFF_MS = 5_000;

export interface OverpassElement {
    type: "node" | "way" | "relation";
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
}

/**
 * `nwr` + `out center` rather than DeFlock's `node` + `out body`: 724 ways and
 * 28 relations carry `man_made=surveillance`, and a node-only query drops them.
 */
export function buildQuery(tier: Tier): string {
    return `[out:json][timeout:${QUERY_TIMEOUT_SEC}];
nwr${tier.selector};
out center tags;`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestMirror(mirror: string, query: string): Promise<OverpassElement[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(mirror, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                // Overpass asks consumers to identify themselves.
                "User-Agent": "WorldWideView-DataEngine (surveillance-infrastructure seeder)",
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

        const body = await res.text();
        // A busy dispatcher answers 200 with an HTML error page.
        if (!body.trimStart().startsWith("{")) {
            throw new Error(`non-JSON response (${body.slice(0, 160).replace(/\s+/g, " ")})`);
        }
        const parsed = JSON.parse(body) as {
            elements?: OverpassElement[];
            osm3s?: { timestamp_osm_base?: string };
        };
        if (!Array.isArray(parsed.elements)) throw new Error("payload has no elements array");

        // Absent or unparseable timestamp: let it through rather than rejecting
        // a mirror over a missing field. The count floor is the second net.
        const base = parsed.osm3s?.timestamp_osm_base;
        if (base) {
            const age = Date.now() - new Date(base).getTime();
            if (Number.isFinite(age) && age > MAX_PLANET_AGE_MS) {
                const days = Math.round(age / 86_400_000);
                throw new Error(`stale planet extract: base ${base} is ~${days} days behind`);
            }
        }
        return parsed.elements;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Outcome of fetching one tier.
 *
 * `implausible` means every mirror answered, but all of them returned far
 * fewer elements than expected. Mirrors are NOT equivalent: one running a
 * stale planet extract answers 200 with valid JSON and a fraction of the data,
 * which is indistinguishable from success unless the count is checked. Treating
 * that as authoritative silently shrinks the dataset.
 */
export interface TierFetchResult {
    elements: OverpassElement[];
    mirror: string;
    implausible: boolean;
}

/**
 * Runs one tier against each mirror until one answers with a plausible count.
 *
 * @param minExpected Reject a response below this many elements and try the
 *   next mirror. Callers derive it from the previous successful sweep, which is
 *   ground truth for this deployment. 0 disables the check (first ever sweep).
 * @throws if every mirror errored — the caller decides whether that is fatal.
 */
export async function fetchTier(tier: Tier, minExpected = 0): Promise<TierFetchResult> {
    const query = buildQuery(tier);
    const failures: string[] = [];
    let best: { elements: OverpassElement[]; host: string } | null = null;

    for (const mirror of overpassMirrors()) {
        const host = new URL(mirror).host;
        const startedAt = Date.now();
        try {
            const elements = await requestMirror(mirror, query);
            const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
            if (!best || elements.length > best.elements.length) best = { elements, host };

            if (minExpected > 0 && elements.length < minExpected) {
                const reason =
                    `returned ${elements.length} elements, below the ${minExpected} floor ` +
                    `(likely a stale planet extract)`;
                console.warn(`[surveillance-infrastructure] tier=${tier.id} mirror=${host} ${reason} — trying the next mirror`);
                failures.push(`${host}: ${reason}`);
                await sleep(MIRROR_BACKOFF_MS);
                continue;
            }

            console.log(
                `[surveillance-infrastructure] tier=${tier.id} mirror=${host} ` +
                    `elements=${elements.length} in ${secs}s`,
            );
            return { elements, mirror: host, implausible: false };
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            failures.push(`${host}: ${reason}`);
            console.warn(`[surveillance-infrastructure] tier=${tier.id} mirror failed — ${reason}`);
            await sleep(MIRROR_BACKOFF_MS);
        }
    }

    if (best) {
        console.error(
            `[surveillance-infrastructure] tier=${tier.id} every mirror was implausible; ` +
                `best was ${best.elements.length} from ${best.host} (floor ${minExpected})`,
        );
        return { elements: best.elements, mirror: best.host, implausible: true };
    }

    throw new Error(`all Overpass mirrors failed for tier "${tier.id}" — ${failures.join("; ")}`);
}
