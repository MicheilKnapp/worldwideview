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

export const OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
] as const;

/** Overpass server-side budget. Global sweeps genuinely need minutes. */
const QUERY_TIMEOUT_SEC = 600;
/** Client-side ceiling, a little above the server budget. */
const REQUEST_TIMEOUT_MS = 660_000;
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
        const parsed = JSON.parse(body) as { elements?: OverpassElement[] };
        if (!Array.isArray(parsed.elements)) throw new Error("payload has no elements array");
        return parsed.elements;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Runs one tier against each mirror until one answers.
 * @throws if every mirror fails — the caller decides whether that is fatal.
 */
export async function fetchTier(tier: Tier): Promise<OverpassElement[]> {
    const query = buildQuery(tier);
    const failures: string[] = [];

    for (const mirror of OVERPASS_MIRRORS) {
        const startedAt = Date.now();
        try {
            const elements = await requestMirror(mirror, query);
            const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
            console.log(
                `[surveillance-infrastructure] tier=${tier.id} mirror=${new URL(mirror).host} ` +
                    `elements=${elements.length} in ${secs}s`,
            );
            return elements;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            failures.push(`${new URL(mirror).host}: ${reason}`);
            console.warn(`[surveillance-infrastructure] tier=${tier.id} mirror failed — ${reason}`);
            await sleep(MIRROR_BACKOFF_MS);
        }
    }

    throw new Error(`all Overpass mirrors failed for tier "${tier.id}" — ${failures.join("; ")}`);
}
