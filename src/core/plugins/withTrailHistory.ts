/**
 * @file withTrailHistory.ts
 * @description Adds an always-visible position trail to a third-party plugin
 * instance that doesn't ship its own, without needing to fork/replace its
 * bundle. Wraps fetch() and mapWebsocketPayload() (whichever the plugin
 * actually uses) to maintain a rolling per-entity position history and
 * inject it into properties.history, and wraps renderEntity() to merge in
 * trailOptions. The host's existing trail renderer (useTrailRendering.ts)
 * picks up properties.history + trailOptions automatically -- this is the
 * same mechanism the first-party ISS plugin uses.
 */
import type { WorldPlugin, GeoEntity, CesiumEntityOptions } from "./PluginTypes";

interface TrailHistoryOptions {
    /** Max position points retained per entity. Default 15. */
    maxPoints?: number;
    trailOptions?: CesiumEntityOptions["trailOptions"];
}

type HistoryPoint = { lat: number; lon: number; ts: number };

export function withTrailHistory(plugin: WorldPlugin, options: TrailHistoryOptions = {}): WorldPlugin {
    const maxPoints = options.maxPoints ?? 15;
    const histories = new Map<string, HistoryPoint[]>();

    function track(entities: GeoEntity[]): GeoEntity[] {
        const seenIds = new Set<string>();
        for (const entity of entities) {
            seenIds.add(entity.id);
            const ts = entity.timestamp ? entity.timestamp.getTime() / 1000 : Date.now() / 1000;
            const history = histories.get(entity.id) ?? [];
            const last = history[history.length - 1];
            if (!last || last.ts !== ts) {
                history.push({ lat: entity.latitude, lon: entity.longitude, ts });
                if (history.length > maxPoints) history.shift();
            }
            histories.set(entity.id, history);
            entity.properties = { ...entity.properties, history };
        }

        // Drop history for entities no longer present (out of range, landed,
        // docked, etc.) so this doesn't grow unbounded.
        for (const id of histories.keys()) {
            if (!seenIds.has(id)) histories.delete(id);
        }

        return entities;
    }

    const originalFetch = plugin.fetch.bind(plugin);
    plugin.fetch = async (timeRange) => track(await originalFetch(timeRange));

    const originalMapWs = (plugin as { mapWebsocketPayload?: (payload: unknown) => GeoEntity[] }).mapWebsocketPayload;
    if (typeof originalMapWs === "function") {
        (plugin as { mapWebsocketPayload: (payload: unknown) => GeoEntity[] }).mapWebsocketPayload = (payload: unknown) =>
            track(originalMapWs.call(plugin, payload));
    }

    const originalRenderEntity = plugin.renderEntity.bind(plugin);
    plugin.renderEntity = (entity) => {
        const base = originalRenderEntity(entity);
        return {
            ...base,
            trailOptions: {
                width: 2,
                opacityFade: true,
                ...options.trailOptions,
                ...base.trailOptions,
            },
        };
    };

    return plugin;
}
