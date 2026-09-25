/**
 * Surveillance device tiers.
 *
 * Each tier is one Overpass query. They are run independently so a failure or
 * timeout on the large ALPR sweep cannot take the small tiers down with it, and
 * so the unverified `public_space` tier can be disabled without touching the
 * rest.
 *
 * Tag values come from OSM taginfo (measured 2026-09-25):
 *   surveillance:type=ALPR              153,759
 *   surveillance:type=gunshot_detector    3,679
 *   surveillance:type=AFR                    67
 *   surveillance=public                 287,060  (narrowed by surveillance:zone)
 *
 * The ALPR matcher is a case-insensitive *substring* on purpose: it picks up
 * `alpr`, `camera;ALPR`, `ALPR;camera` and `ALPR;guard`, which an exact `="ALPR"`
 * match silently drops. The other matchers are anchored — a substring match on
 * "AFR" would be far too loose.
 */

import type { TierId } from "./regions";

export type { TierId };

export interface Tier {
    id: TierId;
    label: string;
    /** Overpass QL statement body, without the enclosing query envelope. */
    selector: string;
    /**
     * False for tiers whose device role is inferred rather than tagged.
     * The frontend uses this to label the layer as unverified.
     */
    verified: boolean;
    /** Rough expected size, used only to order queries smallest-first on retry. */
    approxCount: number;
}

export const TIERS: readonly Tier[] = [
    {
        id: "alpr",
        label: "Licence plate readers (ALPR)",
        selector: '["man_made"="surveillance"]["surveillance:type"~"ALPR",i]',
        verified: true,
        approxCount: 153_800,
    },
    {
        id: "gunshot_detector",
        label: "Gunshot detectors",
        selector: '["man_made"="surveillance"]["surveillance:type"~"^gunshot_detector$",i]',
        verified: true,
        approxCount: 3_700,
    },
    {
        id: "afr",
        label: "Facial recognition cameras",
        selector: '["man_made"="surveillance"]["surveillance:type"~"^AFR$",i]',
        verified: true,
        approxCount: 70,
    },
    {
        id: "public_space",
        label: "Public-space cameras (operator unverified)",
        selector:
            '["man_made"="surveillance"]["surveillance"="public"]["surveillance:zone"~"^(town|street)$"]',
        verified: false,
        approxCount: 60_000,
    },
] as const;

/**
 * Tags kept on each node. Everything else is discarded before the data is
 * cached — these points are rendered on a globe, not re-published as an OSM
 * mirror, and a whitelist keeps the cached payload an order of magnitude
 * smaller. Extends DeFlock's 9-key list with the fields our Intel panel renders.
 */
export const WHITELISTED_TAGS = [
    "operator",
    "manufacturer",
    "direction",
    "brand",
    "camera:direction",
    "camera:type",
    "surveillance",
    "surveillance:type",
    "surveillance:zone",
    "surveillance:brand",
    "surveillance:operator",
    "surveillance:manufacturer",
    "wikimedia_commons",
    "name",
    "ref",
    "start_date",
    "website",
] as const;

export function tierById(id: string): Tier | undefined {
    return TIERS.find((t) => t.id === id);
}

/** Tiers enabled for a run. `PUBLIC_SPACE_TIER=0` drops the unverified tier. */
export function enabledTiers(env: NodeJS.ProcessEnv = process.env): Tier[] {
    const includeUnverified = env.PUBLIC_SPACE_TIER !== "0";
    return TIERS.filter((t) => t.verified || includeUnverified);
}
