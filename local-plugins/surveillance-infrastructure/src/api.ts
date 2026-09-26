/**
 * Talks to the app's own cache route, never to Overpass directly.
 *
 *   GET /api/plugins/surveillance-infrastructure               -> cluster summary
 *   GET /api/plugins/surveillance-infrastructure?bbox=w,s,e,n  -> devices in view
 */

import type { GeoEntity } from "@worldwideview/wwv-plugin-sdk";
import { urlProp, imageProp } from "@worldwideview/wwv-plugin-sdk";

import { tierMeta, type TierId } from "./tiers";

export const PLUGIN_ID = "surveillance-infrastructure";
const ENDPOINT = "/api/plugins/surveillance-infrastructure";

/** [lat, lon, total, alpr, gunshot, afr, publicSpace] */
export type SummaryCell = [number, number, number, number, number, number, number];

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

export interface SummaryResponse {
    mode: "summary";
    fetchedAt: string;
    total: number;
    counts: Record<string, number>;
    degradedTiers: string[];
    summary: SummaryCell[];
}

export interface DetailResponse {
    mode: "detail";
    fetchedAt: string;
    count: number;
    truncated: boolean;
    degradedTiers: string[];
    devices: DeviceRecord[];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
}

export function fetchSummary(signal?: AbortSignal): Promise<SummaryResponse> {
    return getJson<SummaryResponse>(ENDPOINT, signal);
}

export function fetchDetail(
    bbox: { west: number; south: number; east: number; north: number },
    tiers: TierId[] | null,
    signal?: AbortSignal,
): Promise<DetailResponse> {
    const params = new URLSearchParams({
        bbox: `${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`,
    });
    if (tiers && tiers.length > 0) params.set("tiers", tiers.join(","));
    return getJson<DetailResponse>(`${ENDPOINT}?${params}`, signal);
}

const OSM_BASE = "https://www.openstreetmap.org";

function osmUrl(id: string): string {
    // Records are stored as "node/123", which is already the OSM URL path.
    return `${OSM_BASE}/${id}`;
}

function commonsUrl(value: string | undefined): string | null {
    if (!value) return null;
    return `https://commons.wikimedia.org/wiki/${encodeURIComponent(value)}`;
}

export function deviceToEntity(device: DeviceRecord, timestamp: Date): GeoEntity {
    const meta = tierMeta(device.t);
    const tags = device.tags;
    const operator =
        tags["surveillance:operator"] ?? tags.operator ?? null;
    const manufacturer =
        tags["surveillance:manufacturer"] ?? tags.manufacturer ?? tags["surveillance:brand"] ?? tags.brand ?? null;

    return {
        id: `${PLUGIN_ID}-${device.id}`,
        pluginId: PLUGIN_ID,
        latitude: device.lat,
        longitude: device.lon,
        altitude: 0,
        heading: device.dir ?? undefined,
        timestamp,
        label: tags.name ?? meta.shortLabel,
        properties: {
            kind: "device",
            tier: device.t,
            tierLabel: meta.label,
            verified: meta.verified,
            operator,
            manufacturer,
            direction: device.dir !== null ? `${Math.round(device.dir)}°` : null,
            // A gantry covering several approaches is tagged with every bearing.
            allDirections:
                device.dirs && device.dirs.length > 1
                    ? device.dirs.map((d) => `${Math.round(d)}°`).join(", ")
                    : null,
            zone: tags["surveillance:zone"] ?? null,
            cameraType: tags["camera:type"] ?? null,
            ref: tags.ref ?? null,
            since: tags.start_date ?? null,
            osm: urlProp(osmUrl(device.id)),
            website: urlProp(tags.website ?? null),
            photo: imageProp(commonsUrl(tags.wikimedia_commons)),
            license: "OpenStreetMap contributors, ODbL 1.0",
        },
    };
}

export function summaryToEntities(cells: SummaryCell[], timestamp: Date): GeoEntity[] {
    return cells.map(([lat, lon, total, alpr, gunshot, afr, publicSpace]) => ({
        // Cell origin is the south-west corner; place the marker at its centre.
        id: `${PLUGIN_ID}-cell-${lat}_${lon}`,
        pluginId: PLUGIN_ID,
        latitude: lat + 0.5,
        longitude: lon + 0.5,
        altitude: 0,
        timestamp,
        label: total >= 1000 ? `${Math.round(total / 100) / 10}k` : String(total),
        properties: {
            kind: "cluster",
            count: total,
            alpr,
            gunshotDetectors: gunshot,
            facialRecognition: afr,
            publicSpaceUnverified: publicSpace,
            hint: "Zoom in to load individual devices",
            license: "OpenStreetMap contributors, ODbL 1.0",
        },
    }));
}
