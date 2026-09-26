/**
 * Automatic imagery switching by zoom level.
 *
 * Google Photorealistic 3D Tiles look best on the globe and while flying in,
 * but they carry no place labels. Once the view narrows to roughly a US state,
 * labelled aerial imagery is more useful for orientation, so the base layer
 * swaps to Bing Maps Hybrid and back out again.
 *
 * Two thresholds rather than one: a single boundary makes the layer flap every
 * time the camera drifts across it, which is both ugly and expensive — each
 * switch tears down an imagery layer and builds another.
 */

/** The layer this behaviour applies to. Anything else the user picks is left alone. */
export const GLOBAL_LAYER_ID = "google-3d";
/** Labelled aerial imagery used from state level in. */
export const DETAIL_LAYER_ID = "bing-labels";

/**
 * Camera height below which the detail layer takes over.
 *
 * With Cesium's default 60° field of view the visible width is roughly 1.15×
 * the camera height, so 900 km frames about 1,000 km across — near enough to a
 * large US state.
 */
export const DETAIL_BELOW_M = 900_000;
/** Camera height above which the global layer returns. The gap is the hysteresis band. */
export const GLOBAL_ABOVE_M = 1_100_000;

/**
 * Decides which layer should be forced, given the camera height and whatever is
 * currently forced.
 *
 * @param cameraHeightM Metres above the ellipsoid.
 * @param current The currently forced layer id, or null when the user's own
 *   choice is in effect.
 * @returns The layer id to force, or null to stop forcing. Returning the value
 *   unchanged means "no switch", which the caller uses to avoid a pointless
 *   store write.
 */
export function nextZoomLayer(cameraHeightM: number, current: string | null): string | null {
    // A non-finite height means the camera is not looking at the globe (fully
    // zoomed out, or mid-morph between scene modes). Hold the current state
    // rather than guessing.
    if (!Number.isFinite(cameraHeightM)) return current;

    if (current === DETAIL_LAYER_ID) {
        return cameraHeightM > GLOBAL_ABOVE_M ? null : DETAIL_LAYER_ID;
    }
    return cameraHeightM < DETAIL_BELOW_M ? DETAIL_LAYER_ID : null;
}
