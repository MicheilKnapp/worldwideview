import { useEffect } from "react";
import type { Viewer as CesiumViewer } from "cesium";

import { useStore } from "@/core/state/store";

import { GLOBAL_LAYER_ID, nextZoomLayer } from "./zoomImagery";

/**
 * Swaps the base imagery for labelled aerial once the camera reaches roughly
 * state level, and swaps back on the way out.
 *
 * Only engages while the user's chosen layer is Google Photorealistic 3D. If
 * they have picked something specific, that choice is honoured — silently
 * overriding an explicit selection would be worse than the problem this solves.
 *
 * It also stands down while `fallbackLayerId` is set, because that means Google
 * 3D failed to load at all (see useViewerInitialization). Forcing a layer on
 * top of a genuine failure would fight the recovery path.
 */
export function useZoomImagerySwitch(viewerInstance: CesiumViewer | null, viewerReady: boolean) {
    const viewer = viewerInstance;
    const baseLayerId = useStore((s) => s.mapConfig.baseLayerId);
    const fallbackLayerId = useStore((s) => s.mapConfig.fallbackLayerId);
    const enabled = useStore((s) => s.mapConfig.autoImageryByZoom);

    const active = enabled && baseLayerId === GLOBAL_LAYER_ID && fallbackLayerId === null;

    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        if (!active) {
            // Stop forcing a layer the moment the behaviour stops applying,
            // otherwise a stale override would outlive it.
            if (useStore.getState().mapConfig.zoomLayerId !== null) {
                useStore.getState().updateMapConfig({ zoomLayerId: null });
            }
            return;
        }

        const evaluate = () => {
            if (!viewer || viewer.isDestroyed()) return;
            const height = viewer.camera.positionCartographic?.height ?? Number.NaN;
            const current = useStore.getState().mapConfig.zoomLayerId;
            const next = nextZoomLayer(height, current);
            // Only write on an actual transition: moveEnd fires constantly, and
            // every store write re-runs the imagery effect.
            if (next !== current) {
                useStore.getState().updateMapConfig({ zoomLayerId: next });
            }
        };

        // moveEnd rather than changed: waiting for the camera to settle avoids
        // rebuilding imagery layers mid-flight.
        viewer.camera.moveEnd.addEventListener(evaluate);
        evaluate();

        return () => {
            if (!viewer.isDestroyed()) viewer.camera.moveEnd.removeEventListener(evaluate);
        };
    }, [viewer, viewerReady, active]);
}
