/**
 * Readiness waits used to swap base imagery without a blank frame.
 *
 * The globe renders near-black when it has no imagery, and a Cesium3DTileset
 * renders nothing until its tiles arrive. So the outgoing surface must stay
 * visible until the incoming one actually has content — which means waiting on
 * readiness rather than assuming it.
 *
 * Every wait is bounded. A slow or failed tile fetch must degrade to "switch
 * anyway" rather than leaving the transition half-applied forever.
 */

/** Longest any single transition step will wait before proceeding regardless. */
export const READY_TIMEOUT_MS = 4_000;

interface TileLoadable {
    tilesLoaded?: boolean;
    isDestroyed?: () => boolean;
}

/**
 * Resolves once `tilesLoaded` is true, the deadline passes, or the object is
 * destroyed.
 *
 * Polls rather than using tile-load events: both Globe and Cesium3DTileset
 * expose `tilesLoaded`, but their event shapes differ, and a tileset that is
 * already fully loaded fires nothing at all — an event-only wait would hang on
 * the common case of revisiting a view.
 *
 * @param target Globe or Cesium3DTileset.
 * @param timeoutMs Deadline.
 * @param pollMs Gap between checks.
 * @returns true if it became ready, false if it timed out or went away.
 */
export async function waitForTiles(
    target: TileLoadable | null | undefined,
    timeoutMs: number = READY_TIMEOUT_MS,
    pollMs = 100,
): Promise<boolean> {
    if (!target) return false;

    const deadline = Date.now() + timeoutMs;
    // Read through a call rather than inline: `tilesLoaded` flips while we wait,
    // and a direct comparison lets TypeScript narrow it to false for the rest of
    // the function, which is wrong for a mutating property.
    const ready = () => target.tilesLoaded === true;

    // Already settled: return without yielding, so a cached view does not
    // flicker for a poll interval.
    if (ready()) return true;

    while (Date.now() < deadline) {
        if (target.isDestroyed?.()) return false;
        if (ready()) return true;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return ready();
}

/**
 * Colour the globe shows where it has no imagery yet.
 *
 * Cesium's default is close to black, which reads as a hole in the map during a
 * switch. A muted slate reads as unloaded terrain instead, which is the honest
 * impression and far less jarring if a readiness wait ever times out.
 */
export const GLOBE_BASE_COLOR_CSS = "#1b2430";
