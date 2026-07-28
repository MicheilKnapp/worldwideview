/**
 * ISS Live Tracker — first-party plugin, self-hosted at
 * /plugins/iss/frontend.mjs so it has no external npm/CDN dependency.
 *
 * Replaces the previous @nullptr1945/wwv-plugin-iss marketplace entry,
 * whose npm package was deleted upstream (unpkg returned 404), breaking
 * every instance that auto-seeded it as a default plugin.
 *
 * Uses the app's own /api/iss route (proxies wheretheiss.at), so no
 * plugin-side API key or third-party bundle is required.
 */
export default class IssPlugin {
    id = "iss";
    name = "ISS Live Tracker";
    description = "Real-time International Space Station position tracking.";
    icon = "Satellite";
    category = "space";
    version = "1.0.0";

    async initialize() {}

    destroy() {}

    async fetch() {
        try {
            const res = await fetch("/api/iss");
            if (!res.ok) return [];
            const data = await res.json();
            if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
                return [];
            }
            return [{
                id: "iss-25544",
                pluginId: "iss",
                latitude: data.latitude,
                longitude: data.longitude,
                altitude: (data.altitude || 0) * 1000, // km -> meters
                speed: data.velocity,
                timestamp: data.timestamp ? new Date(data.timestamp * 1000) : new Date(),
                label: "ISS",
                properties: {
                    visibility: data.visibility,
                    footprint: data.footprint,
                    velocity: data.velocity,
                },
            }];
        } catch {
            return [];
        }
    }

    getPollingInterval() {
        return 10000; // matches /api/iss's own 10s revalidate window
    }

    getLayerConfig() {
        return {
            color: "#00ffcc",
            clusterEnabled: false,
            clusterDistance: 0,
        };
    }

    renderEntity() {
        return {
            type: "point",
            color: "#00ffcc",
            size: 12,
            labelText: "ISS",
            distanceDisplayCondition: { near: 0, far: 50000000 },
        };
    }
}
