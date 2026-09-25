/**
 * surveillance-infrastructure
 *
 * Publicly-mapped surveillance devices from OpenStreetMap: licence plate
 * readers, gunshot detectors, facial recognition cameras, and — clearly marked
 * as unverified — municipal public-space cameras.
 *
 * Data © OpenStreetMap contributors, licensed under ODbL 1.0.
 * Tiering approach informed by FoggedLens/deflock (MIT).
 */

import type {
    CesiumEntityOptions,
    FilterDefinition,
    GeoEntity,
    LayerConfig,
    PluginContext,
    SelectionBehavior,
    TimeRange,
    WorldPlugin,
} from "@worldwideview/wwv-plugin-sdk";
import type { ComponentType } from "react";

import pkg from "../package.json";
import { fetchSummary, summaryToEntities, PLUGIN_ID } from "./api";
import { iconFor, TIER_ORDER, TIERS, tierMeta, type TierId } from "./tiers";
import { createViewportComponent, type ViewportHost, type ViewportStatus } from "./viewport";

interface PluginSettings {
    /** Tiers to request from the server. Undefined means all of them. */
    enabledTiers?: TierId[];
}

export default class SurveillanceInfrastructurePlugin implements WorldPlugin {
    id = PLUGIN_ID;
    name = "Surveillance Infrastructure";
    description =
        "Licence plate readers, gunshot detectors and facial recognition cameras mapped in OpenStreetMap.";
    icon = "Cctv";
    category = "infrastructure" as const;
    version = pkg.version;

    private ctx: PluginContext | null = null;
    private status: ViewportStatus | null = null;
    private globeComponent: ComponentType<{ viewer: unknown; enabled: boolean }> | null = null;

    async initialize(ctx: PluginContext): Promise<void> {
        this.ctx = ctx;
    }

    destroy(): void {
        this.ctx = null;
        this.status = null;
        this.globeComponent = null;
    }

    /**
     * Zero — the viewport component owns loading, because what to fetch depends
     * on where the camera is pointing and `fetch()` has no way to know that.
     * The single call the host makes on enable paints the global summary.
     */
    getPollingInterval(): number {
        return 0;
    }

    async fetch(_timeRange: TimeRange): Promise<GeoEntity[]> {
        const res = await fetchSummary();
        this.status = {
            mode: "summary",
            count: res.total,
            truncated: false,
            degradedTiers: res.degradedTiers ?? [],
            fetchedAt: res.fetchedAt,
        };
        return summaryToEntities(res.summary, new Date());
    }

    getLayerConfig(): LayerConfig {
        return {
            color: TIERS.alpr.color,
            clusterEnabled: false, // Cells are pre-clustered server-side.
            clusterDistance: 0,
            maxEntities: 25_000,
        };
    }

    renderEntity(entity: GeoEntity): CesiumEntityOptions {
        const props = entity.properties as Record<string, unknown>;

        // Summary cells are points: size/outline styling is valid here and must
        // never be mixed onto the billboard branch below (the GPU clips it).
        if (props.kind === "cluster") {
            const count = typeof props.count === "number" ? props.count : 1;
            return {
                type: "point",
                color: "#ff4d4d",
                size: Math.min(34, 9 + Math.log10(count + 1) * 9),
                outlineColor: "#1a0000",
                outlineWidth: 2,
                labelText: entity.label,
                disableClustering: true,
            };
        }

        const tier = (props.tier as TierId) ?? "public_space";
        const heading = entity.heading;
        const directional = typeof heading === "number" && Number.isFinite(heading);

        return {
            type: "billboard",
            iconUrl: iconFor(tier, directional),
            iconScale: directional ? 0.55 : 0.4,
            rotation: directional ? heading : 0,
        };
    }

    /** Static infrastructure — no movement, so no trails. */
    getSelectionBehavior(_entity: GeoEntity): SelectionBehavior | null {
        return { showTrail: false, flyToBaseDistance: 1_200 };
    }

    getFilterDefinitions(): FilterDefinition[] {
        return [
            {
                id: "tier",
                label: "Device type",
                type: "select",
                propertyKey: "tier",
                options: TIER_ORDER.map((id) => ({ value: id, label: TIERS[id].label })),
            },
            {
                id: "operator",
                label: "Operator",
                type: "text",
                propertyKey: "operator",
            },
            {
                id: "manufacturer",
                label: "Manufacturer",
                type: "text",
                propertyKey: "manufacturer",
            },
        ];
    }

    getLegend() {
        return TIER_ORDER.map((id) => ({
            label: TIERS[id].verified ? TIERS[id].shortLabel : `${TIERS[id].shortLabel} *`,
            color: TIERS[id].color,
            filterId: "tier",
            filterValue: id,
        }));
    }

    getGlobeComponent(): ComponentType<{ viewer: unknown; enabled: boolean }> {
        if (!this.globeComponent) {
            this.globeComponent = createViewportComponent(this.viewportHost());
        }
        return this.globeComponent;
    }

    /** Latest load status, for anything that wants to surface it. */
    getStatus(): ViewportStatus | null {
        return this.status;
    }

    private viewportHost(): ViewportHost {
        return {
            getTierFilter: () => {
                const settings = this.ctx?.getPluginSettings<PluginSettings>(PLUGIN_ID);
                const tiers = settings?.enabledTiers;
                return tiers && tiers.length > 0 ? tiers : null;
            },
            publish: (entities) => this.ctx?.onDataUpdate(entities),
            onStatus: (status) => {
                this.status = status;
                if (status.truncated) {
                    console.warn(
                        `[${PLUGIN_ID}] result truncated at ${status.count} devices — zoom in further`,
                    );
                }
                if (status.degradedTiers.length > 0) {
                    console.warn(
                        `[${PLUGIN_ID}] stale tiers (last sweep failed): ${status.degradedTiers.join(", ")}`,
                    );
                }
            },
            onError: (error) => this.ctx?.onError(error),
        };
    }
}

export { TIERS, TIER_ORDER, tierMeta };
