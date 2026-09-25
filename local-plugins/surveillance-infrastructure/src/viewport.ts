/**
 * Viewport-bounded loading.
 *
 * The full dataset is ~157k devices — far too many to hold on the globe at
 * once. This component watches the Cesium camera and swaps between two views:
 *
 *   wide view  -> 1° cluster cells (counts only, one small request)
 *   close view -> every device inside the camera rectangle
 *
 * Think of it like a shop directory: standing at the entrance you get "Level 2,
 * 40 shops", and only once you walk onto the floor do you see each shop name.
 */

import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import type { GeoEntity } from "@worldwideview/wwv-plugin-sdk";

import { fetchDetail, fetchSummary, deviceToEntity, summaryToEntities } from "./api";
import type { TierId } from "./tiers";

/** Above this camera span (degrees of longitude) we show clusters, not devices. */
const DETAIL_MAX_SPAN_DEG = 12;
/** Camera settles before we spend a request. */
const DEBOUNCE_MS = 400;

const RAD_TO_DEG = 180 / Math.PI;

export interface ViewportStatus {
    mode: "summary" | "detail" | "error";
    count: number;
    truncated: boolean;
    degradedTiers: string[];
    fetchedAt: string | null;
    message?: string;
}

export interface ViewportHost {
    getTierFilter(): TierId[] | null;
    publish(entities: GeoEntity[]): void;
    onStatus(status: ViewportStatus): void;
    onError(error: Error): void;
}

interface CameraRect {
    west: number;
    south: number;
    east: number;
    north: number;
}

/** Cesium hands back a Rectangle in radians, or undefined when off-globe. */
function readCameraRect(viewer: unknown): CameraRect | null {
    const camera = (viewer as { camera?: { computeViewRectangle?: () => unknown } })?.camera;
    if (!camera?.computeViewRectangle) return null;
    const rect = camera.computeViewRectangle() as
        | { west: number; south: number; east: number; north: number }
        | undefined;
    if (!rect || [rect.west, rect.south, rect.east, rect.north].some((v) => !Number.isFinite(v))) {
        return null;
    }
    return {
        west: rect.west * RAD_TO_DEG,
        south: rect.south * RAD_TO_DEG,
        east: rect.east * RAD_TO_DEG,
        north: rect.north * RAD_TO_DEG,
    };
}

/** Longitude span, accounting for an antimeridian-crossing rectangle. */
function spanDeg(rect: CameraRect): number {
    const lonSpan = rect.east >= rect.west ? rect.east - rect.west : 360 - (rect.west - rect.east);
    return Math.max(lonSpan, rect.north - rect.south);
}

export function createViewportComponent(host: ViewportHost): ComponentType<{
    viewer: unknown;
    enabled: boolean;
}> {
    return function SurveillanceViewport({ viewer, enabled }) {
        const abortRef = useRef<AbortController | null>(null);
        const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        // Avoids re-requesting an identical view on every incidental camera nudge.
        const lastKeyRef = useRef<string>("");

        useEffect(() => {
            if (!viewer || !enabled) return;

            let cancelled = false;

            const run = async () => {
                const rect = readCameraRect(viewer);
                const wide = !rect || spanDeg(rect) > DETAIL_MAX_SPAN_DEG;
                const tiers = host.getTierFilter();
                const key = wide
                    ? `summary:${tiers?.join(",") ?? "all"}`
                    : `detail:${rect.west.toFixed(2)},${rect.south.toFixed(2)},` +
                      `${rect.east.toFixed(2)},${rect.north.toFixed(2)}:${tiers?.join(",") ?? "all"}`;
                if (key === lastKeyRef.current) return;

                abortRef.current?.abort();
                const controller = new AbortController();
                abortRef.current = controller;

                try {
                    const now = new Date();
                    if (wide) {
                        const res = await fetchSummary(controller.signal);
                        if (cancelled) return;
                        lastKeyRef.current = key;
                        host.publish(summaryToEntities(res.summary, now));
                        host.onStatus({
                            mode: "summary",
                            count: res.total,
                            truncated: false,
                            degradedTiers: res.degradedTiers ?? [],
                            fetchedAt: res.fetchedAt,
                        });
                    } else {
                        const res = await fetchDetail(rect, tiers, controller.signal);
                        if (cancelled) return;
                        lastKeyRef.current = key;
                        host.publish(res.devices.map((d) => deviceToEntity(d, now)));
                        host.onStatus({
                            mode: "detail",
                            count: res.count,
                            truncated: res.truncated,
                            degradedTiers: res.degradedTiers ?? [],
                            fetchedAt: res.fetchedAt,
                        });
                    }
                } catch (err) {
                    if (controller.signal.aborted || cancelled) return;
                    // A stale view is better than an empty globe, so entities stay put.
                    lastKeyRef.current = "";
                    const error = err instanceof Error ? err : new Error(String(err));
                    host.onStatus({
                        mode: "error",
                        count: 0,
                        truncated: false,
                        degradedTiers: [],
                        fetchedAt: null,
                        message: error.message,
                    });
                    host.onError(error);
                }
            };

            const schedule = () => {
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = setTimeout(run, DEBOUNCE_MS);
            };

            const moveEnd = (viewer as { camera?: { moveEnd?: { addEventListener: (f: () => void) => void; removeEventListener: (f: () => void) => void } } })
                .camera?.moveEnd;
            moveEnd?.addEventListener(schedule);
            schedule();

            return () => {
                cancelled = true;
                moveEnd?.removeEventListener(schedule);
                if (timerRef.current) clearTimeout(timerRef.current);
                abortRef.current?.abort();
            };
        }, [viewer, enabled]);

        return null;
    };
}
