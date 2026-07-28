/**
 * ISS Live Tracker — first-party plugin, self-hosted at
 * /plugins/iss/frontend.mjs so it has no external npm/CDN dependency.
 *
 * Replaces the previous @nullptr1945/wwv-plugin-iss marketplace entry,
 * whose npm package was deleted upstream (unpkg returned 404), breaking
 * every instance that auto-seeded it as a default plugin.
 *
 * Uses the app's own /api/iss and /api/iss/positions routes (proxying
 * wheretheiss.at), so no plugin-side API key or third-party bundle is
 * required.
 */

const MAX_HISTORY_POINTS = 60; // ~10 minutes of trail at the 10s poll interval

export default class IssPlugin {
    id = "iss";
    name = "ISS Live Tracker";
    description = "Real-time International Space Station position tracking.";
    icon = "Satellite";
    category = "space";
    version = "1.1.0";

    history = [];

    async initialize() {
        // Seed the trail with recent historical positions so it isn't
        // empty on first load -- otherwise it only grows from live polling.
        try {
            const now = Math.floor(Date.now() / 1000);
            const timestamps = [];
            for (let i = 9; i >= 0; i--) timestamps.push(now - i * 60); // last 10 min, 1-min steps
            const res = await fetch(`/api/iss/positions?timestamps=${timestamps.join(",")}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.positions)) {
                    this.history = data.positions.map((p) => ({
                        lat: p.latitude,
                        lon: p.longitude,
                        ts: p.timestamp,
                    }));
                }
            }
        } catch {
            // Non-fatal -- trail just starts empty and grows from live polling.
        }
    }

    destroy() {}

    async fetch() {
        try {
            const res = await fetch("/api/iss");
            if (!res.ok) return [];
            const data = await res.json();
            if (typeof data.latitude !== "number" || typeof data.longitude !== "number") {
                return [];
            }

            const ts = data.timestamp || Math.floor(Date.now() / 1000);
            const last = this.history[this.history.length - 1];
            if (!last || last.ts !== ts) {
                this.history.push({ lat: data.latitude, lon: data.longitude, ts });
                if (this.history.length > MAX_HISTORY_POINTS) this.history.shift();
            }

            return [{
                id: "iss-25544",
                pluginId: "iss",
                latitude: data.latitude,
                longitude: data.longitude,
                altitude: (data.altitude || 0) * 1000, // km -> meters
                speed: data.velocity,
                timestamp: new Date(ts * 1000),
                label: "ISS",
                properties: {
                    visibility: data.visibility,
                    footprint: data.footprint,
                    velocity: data.velocity,
                    website: "url:https://www.nasa.gov/international-space-station/",
                    liveFeed: "video:https://www.youtube.com/watch?v=uwXgcTc8oY8",
                    // Consumed by the host's trail renderer, not displayed directly.
                    history: this.history,
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
            disableManualHorizonCulling: true,
            trailOptions: {
                width: 2,
                color: "#00ffcc",
                dashPattern: "solid",
                opacityFade: true,
            },
        };
    }
}
