import { useEffect, useRef } from "react";
import {
    BillboardCollection,
    Cartesian3,
    HorizontalOrigin,
    SceneTransforms,
    VerticalOrigin,
    type Billboard,
    type Viewer as CesiumViewer,
} from "cesium";

import { useStore } from "@/core/state/store";
import {
    MAX_STREET_LABEL_HEIGHT_M,
    selectStreetLabels,
    type StreetAnchor,
    type StreetWay,
} from "@/lib/mapLabels/streets";
import { streetTileCacheKey, streetTilesForBbox } from "@/lib/mapLabels/tiles";
import { textTexture } from "@/lib/mapLabels/textTexture";

/**
 * Draws street names along roads, above the 3D tiles.
 *
 * The hard part is orientation. Text must follow the road as drawn ON SCREEN,
 * and that angle changes whenever the camera rotates or tilts — a geographic
 * bearing baked in at fetch time would be wrong the moment the view is not
 * north-up. So each anchor carries a second point further along the way, both
 * are projected to window coordinates, and the angle between them becomes the
 * label's screen-space rotation. That has to be recomputed as the camera moves,
 * which is why this hook listens to camera changes and not only to moveEnd.
 *
 * These are Billboards rather than Labels because Cesium's Label has no
 * rotation property — only Billboard does. Each name is therefore rendered to a
 * canvas texture once and drawn as a rotatable image.
 */

const DEBOUNCE_MS = 700;
const RAD_TO_DEG = 180 / Math.PI;
const HALF_PI = Math.PI / 2;

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

/** A billboard plus the world positions needed to re-derive its screen angle. */
interface Oriented {
    label: Billboard;
    at: Cartesian3;
    ahead: Cartesian3;
}

export function useStreetLabels(viewerInstance: CesiumViewer | null, viewerReady: boolean) {
    const viewer = viewerInstance;
    const enabled = useStore((s) => s.mapConfig.showStreetLabels);

    const collectionRef = useRef<BillboardCollection | null>(null);
    const orientedRef = useRef<Oriented[]>([]);
    const waysRef = useRef<StreetWay[]>([]);
    const lastKeyRef = useRef<string>("");

    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        if (!enabled) {
            if (collectionRef.current && !viewer.isDestroyed()) {
                viewer.scene.primitives.remove(collectionRef.current);
            }
            collectionRef.current = null;
            orientedRef.current = [];
            waysRef.current = [];
            lastKeyRef.current = "";
            return;
        }

        const collection = new BillboardCollection();
        viewer.scene.primitives.add(collection);
        collectionRef.current = collection;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let controller: AbortController | null = null;

        /** Re-aims every label at the current camera. Bounded by the label cap. */
        const reorient = () => {
            if (!viewer || viewer.isDestroyed()) return;
            const { scene } = viewer;
            for (const { label, at, ahead } of orientedRef.current) {
                const a = SceneTransforms.worldToWindowCoordinates(scene, at);
                const b = SceneTransforms.worldToWindowCoordinates(scene, ahead);
                if (!a || !b) continue;

                // Window Y grows downward, so negate it to get a conventional
                // counter-clockwise angle, which is what Label.rotation expects.
                let angle = Math.atan2(-(b.y - a.y), b.x - a.x);
                // Keep text right-way-up: a road running right to left would
                // otherwise render its name upside down.
                if (angle > HALF_PI) angle -= Math.PI;
                else if (angle < -HALF_PI) angle += Math.PI;

                label.rotation = angle;
            }
            scene.requestRender?.();
        };

        const draw = (anchors: StreetAnchor[]) => {
            if (!viewer || viewer.isDestroyed() || collection.isDestroyed()) return;
            collection.removeAll();
            orientedRef.current = [];

            for (const anchor of anchors) {
                const at = Cartesian3.fromDegrees(anchor.lon, anchor.lat, 0);
                const ahead = Cartesian3.fromDegrees(anchor.aheadLon, anchor.aheadLat, 0);
                const texture = textTexture(anchor.name, window.devicePixelRatio);
                if (!texture) continue;
                const label = collection.add({
                    position: at,
                    image: texture.url,
                    // Explicit size: without it Cesium uses the texture's device
                    // pixel dimensions, so names would be twice as large on a
                    // retina screen as on a standard one.
                    width: texture.width,
                    height: texture.height,
                    horizontalOrigin: HorizontalOrigin.CENTER,
                    verticalOrigin: VerticalOrigin.CENTER,
                    // Above the photogrammetry, like every other label here.
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                orientedRef.current.push({ label, at, ahead });
            }
            reorient();
        };

        const refresh = async () => {
            if (cancelled || !viewer || viewer.isDestroyed()) return;

            const height = viewer.camera.positionCartographic?.height ?? Number.NaN;
            if (!Number.isFinite(height) || height > MAX_STREET_LABEL_HEIGHT_M) {
                waysRef.current = [];
                lastKeyRef.current = "";
                draw([]);
                return;
            }

            const rect = readCameraRect(viewer);
            if (!rect) return;

            const key = streetTilesForBbox(rect).map(streetTileCacheKey).join("|");
            if (key === lastKeyRef.current) {
                // Same tiles: re-thin for the new height without re-fetching.
                draw(selectStreetLabels(waysRef.current, height, 80, rect));
                return;
            }

            controller?.abort();
            controller = new AbortController();
            try {
                const bboxParam = [rect.west, rect.south, rect.east, rect.north]
                    .map((v) => v.toFixed(4))
                    .join(",");
                const res = await fetch(`/api/map-labels/streets?bbox=${bboxParam}`, {
                    signal: controller.signal,
                });
                if (!res.ok) return;
                const json = (await res.json()) as { ways?: StreetWay[] };
                if (cancelled || viewer.isDestroyed()) return;
                waysRef.current = json.ways ?? [];
                lastKeyRef.current = key;
                draw(selectStreetLabels(waysRef.current, height, 80, rect));
            } catch {
                // Aborted or offline. Labels are decoration; keep what is drawn.
            }
        };

        const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
        };

        // Two listeners, deliberately. Re-aiming is cheap and must track the
        // camera continuously or the text visibly lags the roads; re-fetching
        // is expensive and waits for the camera to settle.
        viewer.camera.changed.addEventListener(reorient);
        viewer.camera.moveEnd.addEventListener(schedule);
        schedule();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            controller?.abort();
            if (!viewer.isDestroyed()) {
                viewer.camera.changed.removeEventListener(reorient);
                viewer.camera.moveEnd.removeEventListener(schedule);
                if (collectionRef.current) viewer.scene.primitives.remove(collectionRef.current);
            }
            collectionRef.current = null;
            orientedRef.current = [];
        };
    }, [viewer, viewerReady, enabled]);
}
