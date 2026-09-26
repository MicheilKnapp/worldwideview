import { useEffect, useRef } from "react";
import {
    Cartesian2,
    Cartesian3,
    Color,
    LabelCollection,
    LabelStyle,
    VerticalOrigin,
    type Viewer as CesiumViewer,
} from "cesium";

import { useStore } from "@/core/state/store";
import { selectVisiblePlaces, type PlaceLabel } from "@/lib/mapLabels/places";
import { tileCacheKey, tilesForBbox } from "@/lib/mapLabels/tiles";

/**
 * Draws OSM place names over the globe.
 *
 * Google Photorealistic 3D Tiles carry no labels, and imagery cannot supply
 * them: an ImageryLayer paints the globe surface, which the tileset covers.
 * These are Label primitives with `disableDepthTestDistance: Infinity`, so they
 * render above the tileset, terrain and buildings alike — the same mechanism
 * that already keeps entity labels visible.
 */

/** Above this camera height the view is too wide for place names to help. */
const MAX_HEIGHT_M = 3_000_000;
/** Camera settles before a request is spent. */
const DEBOUNCE_MS = 700;
const RAD_TO_DEG = 180 / Math.PI;

interface Rect {
    west: number;
    south: number;
    east: number;
    north: number;
}

function readCameraRect(viewer: CesiumViewer): Rect | null {
    const rect = viewer.camera.computeViewRectangle();
    if (!rect) return null;
    const values = [rect.west, rect.south, rect.east, rect.north];
    if (values.some((v) => !Number.isFinite(v))) return null;
    return {
        west: rect.west * RAD_TO_DEG,
        south: rect.south * RAD_TO_DEG,
        east: rect.east * RAD_TO_DEG,
        north: rect.north * RAD_TO_DEG,
    };
}

export function useMapLabels(viewerInstance: CesiumViewer | null, viewerReady: boolean) {
    const viewer = viewerInstance;
    const enabled = useStore((s) => s.mapConfig.showPlaceLabels);

    const collectionRef = useRef<LabelCollection | null>(null);
    const placesRef = useRef<PlaceLabel[]>([]);
    const lastKeyRef = useRef<string>("");

    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        if (!enabled) {
            if (collectionRef.current && !viewer.isDestroyed()) {
                viewer.scene.primitives.remove(collectionRef.current);
            }
            collectionRef.current = null;
            placesRef.current = [];
            lastKeyRef.current = "";
            return;
        }

        const collection = new LabelCollection();
        viewer.scene.primitives.add(collection);
        collectionRef.current = collection;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let controller: AbortController | null = null;

        const draw = (height: number) => {
            if (!viewer || viewer.isDestroyed() || collection.isDestroyed()) return;
            collection.removeAll();
            for (const place of selectVisiblePlaces(placesRef.current, height)) {
                collection.add({
                    position: Cartesian3.fromDegrees(place.lon, place.lat, 0),
                    text: place.name,
                    font: place.kind === "city" ? "bold 15px Inter, sans-serif" : "13px Inter, sans-serif",
                    fillColor: Color.WHITE,
                    outlineColor: Color.BLACK.withAlpha(0.85),
                    outlineWidth: 3,
                    // Outline, not a background: names sit over photography of
                    // every possible brightness, and a halo stays readable on
                    // both a white roof and dark water.
                    style: LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: VerticalOrigin.CENTER,
                    pixelOffset: new Cartesian2(0, 0),
                    // The whole point: draw above the 3D tiles rather than
                    // being occluded by the geometry they sit on.
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
            }
            viewer.scene.requestRender?.();
        };

        const refresh = async () => {
            if (cancelled || !viewer || viewer.isDestroyed()) return;

            const height = viewer.camera.positionCartographic?.height ?? Number.NaN;
            if (!Number.isFinite(height) || height > MAX_HEIGHT_M) {
                placesRef.current = [];
                lastKeyRef.current = "";
                draw(Number.MAX_SAFE_INTEGER);
                return;
            }

            const rect = readCameraRect(viewer);
            if (!rect) return;

            // Key on the TILES the view covers, not the view itself. Keying on
            // the viewport meant every pan and zoom looked like new data and
            // hit the network; tiles mean movement inside an already-fetched
            // area costs nothing, and only crossing a tile boundary fetches.
            const key = tilesForBbox(rect).map(tileCacheKey).join("|");

            if (key === lastKeyRef.current) {
                // Same tiles: re-thin for the new height without re-fetching,
                // so zooming in place is free.
                draw(height);
                return;
            }

            controller?.abort();
            controller = new AbortController();
            try {
                const bboxParam = [rect.west, rect.south, rect.east, rect.north]
                    .map((v) => v.toFixed(3))
                    .join(",");
                const res = await fetch(`/api/map-labels?bbox=${bboxParam}`, {
                    signal: controller.signal,
                });
                if (!res.ok) return;
                const json = (await res.json()) as { places?: PlaceLabel[] };
                if (cancelled || viewer.isDestroyed()) return;
                placesRef.current = json.places ?? [];
                lastKeyRef.current = key;
                draw(height);
            } catch {
                // Aborted or offline. Labels are decoration; leave what is drawn.
            }
        };

        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
        };

        viewer.camera.moveEnd.addEventListener(schedule);
        schedule();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            controller?.abort();
            if (!viewer.isDestroyed()) {
                viewer.camera.moveEnd.removeEventListener(schedule);
                if (collectionRef.current) viewer.scene.primitives.remove(collectionRef.current);
            }
            collectionRef.current = null;
        };
    }, [viewer, viewerReady, enabled]);
}
