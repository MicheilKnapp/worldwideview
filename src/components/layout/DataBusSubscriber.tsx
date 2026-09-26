/**
 * @file DataBusSubscriber.tsx
 * @description Headless component that bridges the DataBus event system with the Zustand store.
 * Handles automatic WebSocket subscription/unsubscription when layers are toggled.
 * @module src/components/layout
 */

"use client";

import { useEffect } from "react";
import { useStore } from "@/core/state/store";
import { dataBus } from "@/core/data/DataBus";
import { pluginManager } from "@/core/plugins/PluginManager";
import { wsClient } from "@/core/data/WsClient";
import { resolveEngineUrl } from "@/core/data/resolveEngineUrl";
import { fetchLocalEngineManifest } from "@/core/data/engineManifest";
import { partitionRenderable } from "@/core/plugins/entityGuards";

/** Last warning per plugin, so a fast stream cannot flood the console. */
const lastUnrenderableWarn = new Map<string, number>();

function warnUnrenderable(pluginId: string, dropped: number, total: number): void {
    const now = Date.now();
    if (now - (lastUnrenderableWarn.get(pluginId) ?? 0) < 60_000) return;
    lastUnrenderableWarn.set(pluginId, now);
    console.warn(
        `[DataBusSubscriber] "${pluginId}" emitted ${dropped}/${total} entities with unusable ` +
            `coordinates; dropped. Commonly a plugin mishandling the engine payload shape.`,
    );
}

/**
 * @component DataBusSubscriber
 * @description Orchestrates side-effects between the event-driven DataBus and the React state store.
 * This component renders no UI; it strictly manages the data pipeline lifecycle.
 */
export function DataBusSubscriber() {
    const setPollingInterval = useStore((s) => s.setPollingInterval);
    const setEntities = useStore((s) => s.setEntities);
    const setEntityCount = useStore((s) => s.setEntityCount);
    const clearEntities = useStore((s) => s.clearEntities);
    const removeLayer = useStore((s) => s.removeLayer);
    const setLayerLoading = useStore((s) => s.setLayerLoading);
    const showErrorToast = useStore((s) => s.showErrorToast);
    const cacheMaxAge = useStore((s) => s.dataConfig.cacheMaxAge);

    useEffect(() => {
        // Detect local engine before subscribing to plugins
        fetchLocalEngineManifest();
        pluginManager.setCacheMaxAge(cacheMaxAge);
    }, [cacheMaxAge]);

    useEffect(() => {
        const unsubReg = dataBus.on("pluginRegistered", ({ pluginId, defaultInterval }) => {
            setTimeout(() => {
                const currentIntervals = useStore.getState().dataConfig.pollingIntervals;
                if (!currentIntervals[pluginId]) {
                    setPollingInterval(pluginId, defaultInterval);
                }
            }, 0);
        });

        const unsubData = dataBus.on("dataUpdated", ({ pluginId, entities }) => {
            // The only path into the store, and several producers emit here
            // (PluginManager polling, cache replay, WsClient). Validating at the
            // consumer means a new producer cannot reintroduce the crash:
            // Cesium throws on a non-numeric coordinate, and because rendering
            // runs in a React effect that unmounts the globe and every layer.
            const { valid, dropped } = partitionRenderable(entities);
            if (dropped > 0) warnUnrenderable(pluginId, dropped, entities.length);

            // Nothing renderable in a non-empty batch means the plugin is
            // malfunctioning, not reporting "no entities". Keep what is on
            // screen rather than blanking the layer on every bad push.
            if (entities.length > 0 && valid.length === 0) return;

            // Defer the state updates by one tick to prevent React "Maximum update depth exceeded"
            // errors during massive synchronous plugin loads (e.g. at boot).
            setTimeout(() => {
                setEntities(pluginId, valid);
                setEntityCount(pluginId, valid.length);
            }, 0);
        });

        const unsubToggle = dataBus.on("layerToggled", ({ pluginId, enabled }) => {
            const t0 = performance.now();
            console.debug(`[DataBusSubscriber] layerToggled event received for ${pluginId}, enabled: ${enabled}`);
            const engineUrl = resolveEngineUrl(pluginId);
            console.debug(`[DataBusSubscriber] Resolved engine URL for ${pluginId} to ${engineUrl}. Took ${(performance.now() - t0).toFixed(2)}ms`);
            if (enabled) {
                console.debug(`[DataBusSubscriber] Calling wsClient.subscribe(${pluginId}, ${engineUrl})`);
                wsClient.subscribe(pluginId, engineUrl);
            } else {
                console.debug(`[DataBusSubscriber] Calling wsClient.unsubscribe(${pluginId}, ${engineUrl})`);
                wsClient.unsubscribe(pluginId, engineUrl);
            }
        });

        const unsubUnreg = dataBus.on("pluginUnregistered", ({ pluginId }) => {
            setTimeout(() => {
                clearEntities(pluginId);
                removeLayer(pluginId);
            }, 0);
        });

        const unsubLoading = dataBus.on("layerLoadingChanged", ({ pluginId, loading }) => {
            setTimeout(() => {
                setLayerLoading(pluginId, loading);
            }, 0);
        });

        const unsubError = dataBus.on("pluginError", ({ message }) => {
            setTimeout(() => {
                if (showErrorToast) {
                    showErrorToast(message);
                }
            }, 0);
        });

        return () => {
            unsubReg();
            unsubUnreg();
            unsubData();
            unsubToggle();
            unsubLoading();
            unsubError();
        };
    }, [setPollingInterval, setEntities, setEntityCount, clearEntities, removeLayer, setLayerLoading, showErrorToast]);

    return null;
}
