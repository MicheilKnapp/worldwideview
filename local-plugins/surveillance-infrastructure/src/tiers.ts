/**
 * Tier display metadata.
 *
 * Mirrors the seeder's tier list
 * (`local-seeders/community/packages/surveillance-infrastructure/src/tiers.ts`).
 * The seeder is a separate repository, so the two lists are kept in step by
 * hand — change them together.
 */

export type TierId = "alpr" | "gunshot_detector" | "afr" | "public_space";

export interface TierMeta {
    id: TierId;
    label: string;
    /** Short form for the legend. */
    shortLabel: string;
    color: string;
    /**
     * False when the device's role is inferred from location tagging rather
     * than tagged directly. Surfaced prominently — mislabelling a shop camera
     * as state surveillance would discredit the whole layer.
     */
    verified: boolean;
}

export const TIERS: Record<TierId, TierMeta> = {
    alpr: {
        id: "alpr",
        label: "Licence plate reader (ALPR)",
        shortLabel: "ALPR",
        color: "#ff4d4d",
        verified: true,
    },
    gunshot_detector: {
        id: "gunshot_detector",
        label: "Gunshot detector",
        shortLabel: "Gunshot",
        color: "#ffb020",
        verified: true,
    },
    afr: {
        id: "afr",
        label: "Facial recognition camera",
        shortLabel: "Facial rec.",
        color: "#c060ff",
        verified: true,
    },
    public_space: {
        id: "public_space",
        label: "Public-space camera — operator unverified",
        shortLabel: "Public-space (unverified)",
        color: "#5aa9e6",
        verified: false,
    },
};

export const TIER_ORDER: readonly TierId[] = [
    "alpr",
    "gunshot_detector",
    "afr",
    "public_space",
];

export function tierMeta(id: string): TierMeta {
    return TIERS[id as TierId] ?? TIERS.public_space;
}

/**
 * Inline SVG icons as data URIs — no binary assets to ship or 404.
 *
 * Each icon points north at rotation 0, so the renderer's bearing rotation
 * lines the cone up with the device's tagged `direction`.
 */
function dataUri(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}

/** Camera body plus a view cone, for devices with a tagged bearing. */
export function directionalIcon(color: string): string {
    return dataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
          <path d="M24 24 L10 2 A26 26 0 0 1 38 2 Z" fill="${color}" fill-opacity="0.35"/>
          <circle cx="24" cy="24" r="6" fill="${color}" stroke="#0b0b0b" stroke-width="2"/>
        </svg>
    `);
}

/** Plain marker for devices with no usable direction tag. */
export function omniIcon(color: string): string {
    return dataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="9" fill="${color}" fill-opacity="0.30"/>
          <circle cx="24" cy="24" r="6" fill="${color}" stroke="#0b0b0b" stroke-width="2"/>
        </svg>
    `);
}

/** Icons are static per tier — build them once, not per entity render. */
const ICON_CACHE = new Map<string, string>();

export function iconFor(tier: TierId, directional: boolean): string {
    const key = `${tier}:${directional}`;
    let icon = ICON_CACHE.get(key);
    if (!icon) {
        const { color } = tierMeta(tier);
        icon = directional ? directionalIcon(color) : omniIcon(color);
        ICON_CACHE.set(key, icon);
    }
    return icon;
}
