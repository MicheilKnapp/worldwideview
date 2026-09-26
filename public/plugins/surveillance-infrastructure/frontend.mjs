"use client";
var package_default = {
	name: "@worldwideview/wwv-plugin-surveillance-infrastructure",
	version: "1.0.0",
	description: "Publicly-mapped surveillance devices from OpenStreetMap — licence plate readers, gunshot detectors, facial recognition cameras and (unverified) public-space cameras.",
	main: "dist/frontend.mjs",
	module: "dist/frontend.mjs",
	exports: { ".": {
		"import": "./dist/frontend.mjs",
		"require": "./dist/frontend.mjs"
	} },
	scripts: { "build": "tsc" },
	peerDependencies: {
		"@worldwideview/wwv-plugin-sdk": "*",
		"lucide-react": "*",
		"react": ">=19"
	},
	worldwideview: {
		"id": "surveillance-infrastructure",
		"pluginId": "surveillance-infrastructure",
		"name": "Surveillance Infrastructure",
		"description": "Licence plate readers, gunshot detectors and facial recognition cameras mapped in OpenStreetMap.",
		"type": "data-layer",
		"format": "bundle",
		"category": "infrastructure",
		"icon": "Cctv",
		"capabilities": [
			"data:own",
			"globe:overlay",
			"network:fetch"
		],
		"author": "WorldWideView",
		"dev_entry": "src/index.ts",
		"attribution": {
			"text": "© OpenStreetMap contributors",
			"license": "ODbL 1.0",
			"licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/"
		}
	}
};
//#endregion
//#region local-plugins/surveillance-infrastructure/src/tiers.ts
var TIERS = {
	alpr: {
		id: "alpr",
		label: "Licence plate reader (ALPR)",
		shortLabel: "ALPR",
		color: "#ff4d4d",
		verified: true
	},
	gunshot_detector: {
		id: "gunshot_detector",
		label: "Gunshot detector",
		shortLabel: "Gunshot",
		color: "#ffb020",
		verified: true
	},
	afr: {
		id: "afr",
		label: "Facial recognition camera",
		shortLabel: "Facial rec.",
		color: "#c060ff",
		verified: true
	},
	public_space: {
		id: "public_space",
		label: "Public-space camera — operator unverified",
		shortLabel: "Public-space (unverified)",
		color: "#5aa9e6",
		verified: false
	}
};
var TIER_ORDER = [
	"alpr",
	"gunshot_detector",
	"afr",
	"public_space"
];
function tierMeta(id) {
	return TIERS[id] ?? TIERS.public_space;
}
/**
* Inline SVG icons as data URIs — no binary assets to ship or 404.
*
* Icons are deliberately COLOUR-NEUTRAL (white). Cesium multiplies a
* billboard's texture by `CesiumEntityOptions.color`, so baking a tier colour
* into the SVG and leaving `color` unset means the icon gets multiplied by the
* host's default, which is CYAN — the rendered points then match nothing in the
* legend. Keeping the artwork white and passing the tier colour as `color`
* makes the tint authoritative and the legend correct by construction.
*
* Fill opacity survives tinting, so the view cone stays translucent. The near
* black outline stays dark, since black multiplied by anything is black.
*
* Each icon points north at rotation 0, so the renderer's bearing rotation
* lines the cone up with the device's tagged `direction`.
*/
function dataUri(svg) {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}
/** Camera body plus a view cone, for devices with a tagged bearing. */
function directionalIcon() {
	return dataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
          <path d="M24 24 L10 2 A26 26 0 0 1 38 2 Z" fill="#ffffff" fill-opacity="0.35"/>
          <circle cx="24" cy="24" r="6" fill="#ffffff" stroke="#0b0b0b" stroke-width="2"/>
        </svg>
    `);
}
/** Plain marker for devices with no usable direction tag. */
function omniIcon() {
	return dataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="9" fill="#ffffff" fill-opacity="0.30"/>
          <circle cx="24" cy="24" r="6" fill="#ffffff" stroke="#0b0b0b" stroke-width="2"/>
        </svg>
    `);
}
/** Two icons total, built once. The tier colour is applied as a tint. */
var ICON_CACHE = /* @__PURE__ */ new Map();
function iconFor(directional) {
	const key = directional ? "cone" : "omni";
	let icon = ICON_CACHE.get(key);
	if (!icon) {
		icon = directional ? directionalIcon() : omniIcon();
		ICON_CACHE.set(key, icon);
	}
	return icon;
}
//#endregion
//#region local-plugins/surveillance-infrastructure/src/api.ts
var PLUGIN_ID = "surveillance-infrastructure";
var ENDPOINT = "/api/plugins/surveillance-infrastructure";
async function getJson(url, signal) {
	const res = await fetch(url, {
		signal,
		headers: { Accept: "application/json" }
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
	}
	return await res.json();
}
function fetchSummary(signal) {
	return getJson(ENDPOINT, signal);
}
function fetchDetail(bbox, tiers, signal) {
	const params = new URLSearchParams({ bbox: `${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}` });
	if (tiers && tiers.length > 0) params.set("tiers", tiers.join(","));
	return getJson(`${ENDPOINT}?${params}`, signal);
}
var OSM_BASE = "https://www.openstreetmap.org";
function osmUrl(id) {
	return `${OSM_BASE}/${id}`;
}
function commonsUrl(value) {
	if (!value) return null;
	return `https://commons.wikimedia.org/wiki/${encodeURIComponent(value)}`;
}
function deviceToEntity(device, timestamp) {
	const meta = tierMeta(device.t);
	const tags = device.tags;
	const operator = tags["surveillance:operator"] ?? tags.operator ?? null;
	const manufacturer = tags["surveillance:manufacturer"] ?? tags.manufacturer ?? tags["surveillance:brand"] ?? tags.brand ?? null;
	return {
		id: `${PLUGIN_ID}-${device.id}`,
		pluginId: PLUGIN_ID,
		latitude: device.lat,
		longitude: device.lon,
		altitude: 0,
		heading: device.dir ?? void 0,
		timestamp,
		label: tags.name ?? meta.shortLabel,
		properties: {
			kind: "device",
			tier: device.t,
			tierLabel: meta.label,
			verified: meta.verified,
			operator,
			manufacturer,
			direction: device.dir !== null ? `${Math.round(device.dir)}°` : null,
			allDirections: device.dirs && device.dirs.length > 1 ? device.dirs.map((d) => `${Math.round(d)}°`).join(", ") : null,
			zone: tags["surveillance:zone"] ?? null,
			cameraType: tags["camera:type"] ?? null,
			ref: tags.ref ?? null,
			since: tags.start_date ?? null,
			osm: globalThis.__WWV_HOST__.WWVPluginSDK.urlProp(osmUrl(device.id)),
			website: globalThis.__WWV_HOST__.WWVPluginSDK.urlProp(tags.website ?? null),
			photo: globalThis.__WWV_HOST__.WWVPluginSDK.imageProp(commonsUrl(tags.wikimedia_commons)),
			license: "OpenStreetMap contributors, ODbL 1.0"
		}
	};
}
function summaryToEntities(cells, timestamp) {
	return cells.map(([lat, lon, total, alpr, gunshot, afr, publicSpace]) => ({
		id: `${PLUGIN_ID}-cell-${lat}_${lon}`,
		pluginId: PLUGIN_ID,
		latitude: lat + .5,
		longitude: lon + .5,
		altitude: 0,
		timestamp,
		label: total >= 1e3 ? `${Math.round(total / 100) / 10}k` : String(total),
		properties: {
			kind: "cluster",
			count: total,
			alpr,
			gunshotDetectors: gunshot,
			facialRecognition: afr,
			publicSpaceUnverified: publicSpace,
			hint: "Zoom in to load individual devices",
			license: "OpenStreetMap contributors, ODbL 1.0"
		}
	}));
}
//#endregion
//#region local-plugins/surveillance-infrastructure/src/viewport.ts
/**
* Viewport-bounded loading.
*
* The full dataset is ~157k devices — far too many to hold on the globe at
* once. This component watches the Cesium camera and swaps between two views:
*
*   wide view  -> 1° cluster cells (counts only, one small request)
*   close view -> every device inside the camera rectangle
*
* Think of it like a shop directory: standing at the entrance you get "Level 2,
* 40 shops", and only once you walk onto the floor do you see each shop name.
*/
/** Above this camera span (degrees of longitude) we show clusters, not devices. */
var DETAIL_MAX_SPAN_DEG = 12;
/** Camera settles before we spend a request. */
var DEBOUNCE_MS = 400;
var RAD_TO_DEG = 180 / Math.PI;
/** Cesium hands back a Rectangle in radians, or undefined when off-globe. */
function readCameraRect(viewer) {
	const camera = viewer?.camera;
	if (!camera?.computeViewRectangle) return null;
	const rect = camera.computeViewRectangle();
	if (!rect || [
		rect.west,
		rect.south,
		rect.east,
		rect.north
	].some((v) => !Number.isFinite(v))) return null;
	return {
		west: rect.west * RAD_TO_DEG,
		south: rect.south * RAD_TO_DEG,
		east: rect.east * RAD_TO_DEG,
		north: rect.north * RAD_TO_DEG
	};
}
/** Longitude span, accounting for an antimeridian-crossing rectangle. */
function spanDeg(rect) {
	const lonSpan = rect.east >= rect.west ? rect.east - rect.west : 360 - (rect.west - rect.east);
	return Math.max(lonSpan, rect.north - rect.south);
}
function createViewportComponent(host) {
	return function SurveillanceViewport({ viewer, enabled }) {
		const abortRef = globalThis.__WWV_HOST__.React.useRef(null);
		const timerRef = globalThis.__WWV_HOST__.React.useRef(null);
		const lastKeyRef = globalThis.__WWV_HOST__.React.useRef("");
		globalThis.__WWV_HOST__.React.useEffect(() => {
			if (!viewer || !enabled) return;
			let cancelled = false;
			const run = async () => {
				const rect = readCameraRect(viewer);
				const wide = !rect || spanDeg(rect) > DETAIL_MAX_SPAN_DEG;
				const tiers = host.getTierFilter();
				const key = wide ? `summary:${tiers?.join(",") ?? "all"}` : `detail:${rect.west.toFixed(2)},${rect.south.toFixed(2)},${rect.east.toFixed(2)},${rect.north.toFixed(2)}:${tiers?.join(",") ?? "all"}`;
				if (key === lastKeyRef.current) return;
				abortRef.current?.abort();
				const controller = new AbortController();
				abortRef.current = controller;
				try {
					const now = /* @__PURE__ */ new Date();
					if (wide) {
						const res = await fetchSummary(controller.signal);
						if (cancelled) return;
						lastKeyRef.current = key;
						host.publish(summaryToEntities(res.summary, now));
						host.onStatus({
							mode: "summary",
							count: res.total,
							truncated: false,
							degradedTiers: res.degradedTiers ?? [],
							fetchedAt: res.fetchedAt
						});
					} else {
						const res = await fetchDetail(rect, tiers, controller.signal);
						if (cancelled) return;
						lastKeyRef.current = key;
						host.publish(res.devices.map((d) => deviceToEntity(d, now)));
						host.onStatus({
							mode: "detail",
							count: res.count,
							truncated: res.truncated,
							degradedTiers: res.degradedTiers ?? [],
							fetchedAt: res.fetchedAt
						});
					}
				} catch (err) {
					if (controller.signal.aborted || cancelled) return;
					lastKeyRef.current = "";
					const error = err instanceof Error ? err : new Error(String(err));
					host.onStatus({
						mode: "error",
						count: 0,
						truncated: false,
						degradedTiers: [],
						fetchedAt: null,
						message: error.message
					});
					host.onError(error);
				}
			};
			const schedule = () => {
				if (timerRef.current) clearTimeout(timerRef.current);
				timerRef.current = setTimeout(run, DEBOUNCE_MS);
			};
			const moveEnd = viewer.camera?.moveEnd;
			moveEnd?.addEventListener(schedule);
			schedule();
			return () => {
				cancelled = true;
				moveEnd?.removeEventListener(schedule);
				if (timerRef.current) clearTimeout(timerRef.current);
				abortRef.current?.abort();
			};
		}, [viewer, enabled]);
		return null;
	};
}
//#endregion
//#region local-plugins/surveillance-infrastructure/src/index.ts
/**
* The tier contributing the most devices to a summary cell.
*
* Summary cells are mixed by nature, so one colour can only ever be
* representative. Picking the majority keeps the swatch meaningful and
* consistent with the legend; ties fall to TIER_ORDER, which puts the
* verified tiers ahead of the unverified one.
*/
function dominantTier(props) {
	const counts = {
		alpr: Number(props.alpr) || 0,
		gunshot_detector: Number(props.gunshotDetectors) || 0,
		afr: Number(props.facialRecognition) || 0,
		public_space: Number(props.publicSpaceUnverified) || 0
	};
	let best = TIER_ORDER[0];
	for (const id of TIER_ORDER) if (counts[id] > counts[best]) best = id;
	return best;
}
var SurveillanceInfrastructurePlugin = class {
	id = PLUGIN_ID;
	name = "Surveillance Infrastructure";
	description = "Licence plate readers, gunshot detectors and facial recognition cameras mapped in OpenStreetMap.";
	icon = "Cctv";
	category = "infrastructure";
	version = package_default.version;
	ctx = null;
	status = null;
	globeComponent = null;
	async initialize(ctx) {
		this.ctx = ctx;
	}
	destroy() {
		this.ctx = null;
		this.status = null;
		this.globeComponent = null;
	}
	/**
	* Zero — the viewport component owns loading, because what to fetch depends
	* on where the camera is pointing and `fetch()` has no way to know that.
	* The single call the host makes on enable paints the global summary.
	*/
	getPollingInterval() {
		return 0;
	}
	async fetch(_timeRange) {
		const res = await fetchSummary();
		this.status = {
			mode: "summary",
			count: res.total,
			truncated: false,
			degradedTiers: res.degradedTiers ?? [],
			fetchedAt: res.fetchedAt
		};
		return summaryToEntities(res.summary, /* @__PURE__ */ new Date());
	}
	getLayerConfig() {
		return {
			color: TIERS.alpr.color,
			clusterEnabled: false,
			clusterDistance: 0,
			maxEntities: 25e3
		};
	}
	renderEntity(entity) {
		const props = entity.properties;
		if (props.kind === "cluster") {
			const count = typeof props.count === "number" ? props.count : 1;
			return {
				type: "point",
				color: TIERS[dominantTier(props)].color,
				size: Math.min(34, 9 + Math.log10(count + 1) * 9),
				outlineColor: "#0b0b0b",
				outlineWidth: 2,
				labelText: entity.label,
				disableClustering: true
			};
		}
		const tier = props.tier ?? "public_space";
		const heading = entity.heading;
		const directional = typeof heading === "number" && Number.isFinite(heading);
		return {
			type: "billboard",
			iconUrl: iconFor(directional),
			color: tierMeta(tier).color,
			iconScale: directional ? .55 : .4,
			rotation: directional ? heading : 0
		};
	}
	/** Static infrastructure — no movement, so no trails. */
	getSelectionBehavior(_entity) {
		return {
			showTrail: false,
			flyToBaseDistance: 1200
		};
	}
	getFilterDefinitions() {
		return [
			{
				id: "tier",
				label: "Device type",
				type: "select",
				propertyKey: "tier",
				options: TIER_ORDER.map((id) => ({
					value: id,
					label: TIERS[id].label
				}))
			},
			{
				id: "operator",
				label: "Operator",
				type: "text",
				propertyKey: "operator"
			},
			{
				id: "manufacturer",
				label: "Manufacturer",
				type: "text",
				propertyKey: "manufacturer"
			}
		];
	}
	getLegend() {
		return TIER_ORDER.map((id) => ({
			label: TIERS[id].verified ? TIERS[id].shortLabel : `${TIERS[id].shortLabel} *`,
			color: TIERS[id].color,
			filterId: "tier",
			filterValue: id
		}));
	}
	getGlobeComponent() {
		if (!this.globeComponent) this.globeComponent = createViewportComponent(this.viewportHost());
		return this.globeComponent;
	}
	/** Latest load status, for anything that wants to surface it. */
	getStatus() {
		return this.status;
	}
	viewportHost() {
		return {
			getTierFilter: () => {
				const tiers = (this.ctx?.getPluginSettings(PLUGIN_ID))?.enabledTiers;
				return tiers && tiers.length > 0 ? tiers : null;
			},
			publish: (entities) => this.ctx?.onDataUpdate(entities),
			onStatus: (status) => {
				this.status = status;
				if (status.truncated) console.warn(`[${PLUGIN_ID}] result truncated at ${status.count} devices — zoom in further`);
				if (status.degradedTiers.length > 0) console.warn(`[${PLUGIN_ID}] stale tiers (last sweep failed): ${status.degradedTiers.join(", ")}`);
			},
			onError: (error) => this.ctx?.onError(error)
		};
	}
};
//#endregion
export { TIERS, TIER_ORDER, SurveillanceInfrastructurePlugin as default, tierMeta };

//# sourceMappingURL=frontend.mjs.map