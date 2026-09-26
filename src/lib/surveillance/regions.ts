/**
 * Region grid maths for the surveillance-infrastructure layer.
 *
 * These constants MUST stay in step with the seeder
 * (`local-seeders/community/packages/surveillance-infrastructure/src/regions.ts`).
 * The seeder lives in its own repository, so the grid definition is duplicated
 * rather than imported — keep both sides small and change them together.
 */

export const REGION_SIZE_DEG = 20;
export const KEY_PREFIX = "data:surveillance-infrastructure";

export type TierId = "alpr" | "gunshot_detector" | "afr" | "public_space";

export const TIER_IDS: readonly TierId[] = ["alpr", "gunshot_detector", "afr", "public_space"];

/** Tiers whose device role is inferred, not tagged. Surfaced as unverified. */
export const UNVERIFIED_TIERS: readonly TierId[] = ["public_space"];

export interface DeviceRecord {
    id: string;
    lat: number;
    lon: number;
    t: TierId;
    dir: number | null;
    /** All bearings, when the device covers more than one (multi-lane gantry). */
    dirs?: number[];
    tags: Record<string, string>;
}

export interface RegionPayload {
    fetchedAt: string;
    devices: DeviceRecord[];
}

export const ATTRIBUTION = {
    text: "© OpenStreetMap contributors",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    sourceUrl: "https://www.openstreetmap.org/copyright",
} as const;

function cellOrigin(value: number, size: number): number {
    return Math.floor(value / size) * size;
}

export interface Bbox {
    west: number;
    south: number;
    east: number;
    north: number;
}

/**
 * Parses a `west,south,east,north` bbox parameter.
 * Returns null when malformed so callers can answer 400 rather than guess.
 */
export function parseBbox(raw: string | null): Bbox | null {
    if (!raw) return null;
    const parts = raw.split(",").map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [west, south, east, north] = parts;
    if (south > north) return null;
    if (west < -180 || east > 180 || south < -90 || north > 90) return null;
    return { west, south, east, north };
}

/** True when a bbox crosses the antimeridian (west greater than east). */
export function crossesAntimeridian(bbox: Bbox): boolean {
    return bbox.west > bbox.east;
}

/**
 * Region keys whose 20° cell intersects the bbox. An antimeridian-crossing
 * bbox is split into two spans so the longitude walk never runs backwards.
 */
export function regionsForBbox(bbox: Bbox): string[] {
    const spans: Array<[number, number]> = crossesAntimeridian(bbox)
        ? [
              [bbox.west, 180],
              [-180, bbox.east],
          ]
        : [[bbox.west, bbox.east]];

    const keys = new Set<string>();
    const latStart = cellOrigin(Math.max(bbox.south, -90), REGION_SIZE_DEG);
    const latEnd = cellOrigin(Math.min(bbox.north, 90), REGION_SIZE_DEG);

    for (const [spanWest, spanEast] of spans) {
        const lonStart = cellOrigin(Math.max(spanWest, -180), REGION_SIZE_DEG);
        const lonEnd = cellOrigin(Math.min(spanEast, 180), REGION_SIZE_DEG);
        for (let lat = latStart; lat <= latEnd; lat += REGION_SIZE_DEG) {
            for (let lon = lonStart; lon <= lonEnd; lon += REGION_SIZE_DEG) {
                keys.add(`${lat}/${lon}`);
            }
        }
    }
    return [...keys];
}

export function redisKeyForRegion(regionKey: string): string {
    const [lat, lon] = regionKey.split("/");
    return `${KEY_PREFIX}:region:${lat}:${lon}`;
}

export function withinBbox(device: DeviceRecord, bbox: Bbox): boolean {
    if (device.lat < bbox.south || device.lat > bbox.north) return false;
    return crossesAntimeridian(bbox)
        ? device.lon >= bbox.west || device.lon <= bbox.east
        : device.lon >= bbox.west && device.lon <= bbox.east;
}

/** Validates a comma-separated `tiers` filter, ignoring unknown values. */
export function parseTiers(raw: string | null): TierId[] | null {
    if (!raw) return null;
    const requested = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const valid = requested.filter((t): t is TierId => (TIER_IDS as readonly string[]).includes(t));
    return valid.length > 0 ? valid : null;
}

export const SUMMARY_CELL_DEG = 1;

export function regionKeyFor(lat: number, lon: number): string {
    return `${cellOrigin(lat, REGION_SIZE_DEG)}/${cellOrigin(lon, REGION_SIZE_DEG)}`;
}

export function segmentIntoRegions(records: DeviceRecord[]): Map<string, DeviceRecord[]> {
    const regions = new Map<string, DeviceRecord[]>();
    for (const record of records) {
        const key = regionKeyFor(record.lat, record.lon);
        const bucket = regions.get(key);
        if (bucket) bucket.push(record);
        else regions.set(key, [record]);
    }
    return regions;
}

/**
 * Compact cluster cell: [lat, lon, total, alpr, gunshot, afr, publicSpace].
 * Tuples rather than objects — at ~10k populated cells the key names would be
 * most of the payload.
 */
export type SummaryCell = [number, number, number, number, number, number, number];

const TIER_SLOT: Record<TierId, number> = {
    alpr: 3,
    gunshot_detector: 4,
    afr: 5,
    public_space: 6,
};

export function buildSummary(records: DeviceRecord[]): SummaryCell[] {
    const cells = new Map<string, SummaryCell>();
    for (const record of records) {
        const lat = cellOrigin(record.lat, SUMMARY_CELL_DEG);
        const lon = cellOrigin(record.lon, SUMMARY_CELL_DEG);
        const key = `${lat}/${lon}`;
        let cell = cells.get(key);
        if (!cell) {
            cell = [lat, lon, 0, 0, 0, 0, 0];
            cells.set(key, cell);
        }
        cell[2] += 1;
        cell[TIER_SLOT[record.t]] += 1;
    }
    return [...cells.values()];
}

export function countByTier(records: DeviceRecord[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of records) {
        counts[record.t] = (counts[record.t] ?? 0) + 1;
    }
    return counts;
}
