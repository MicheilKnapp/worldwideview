/* eslint-disable react-hooks/immutability */
import { useEffect, useRef } from "react";
import {
    Viewer as CesiumViewer,
    ImageryLayer,
    SceneMode,
    Cesium3DTileset,
    Cesium3DTileStyle,
    Terrain,
    UrlTemplateImageryProvider,
    createOsmBuildingsAsync,
    Color
} from "cesium";
import { useStore } from "@/core/state/store";
import { createImageryProvider, createOsmProvider } from "./ImageryProviderFactory";
import { GLOBE_BASE_COLOR_CSS, waitForTiles } from "./imageryTransition";

/** Built once: Cesium keeps a reference, and re-parsing per transition is waste. */
const GLOBE_BASE_COLOR = Color.fromCssColorString(GLOBE_BASE_COLOR_CSS);

/** Fill colour for OSM 3D Buildings. */
const OSM_BUILDING_COLOR = "#E0DDD5";
/**
 * Building opacity.
 *
 * Street and place names are baked into the base imagery, which sits on the
 * globe surface, while these buildings are solid geometry above it — so opaque
 * buildings hide the labels underneath exactly where they matter most, at
 * close zoom. Translucent fill lets the names read through while the massing
 * and outlines stay legible.
 */
const OSM_BUILDING_ALPHA = 0.5;

export function useImageryManager(viewerInstance: CesiumViewer | null, viewerReady: boolean) {
    const viewer = viewerInstance;
    const baseLayerId = useStore((s) => s.mapConfig.baseLayerId);
    const fallbackLayerId = useStore((s) => s.mapConfig.fallbackLayerId);
    const zoomLayerId = useStore((s) => s.mapConfig.zoomLayerId);
    const sceneMode = useStore((s) => s.mapConfig.sceneMode);
    const showOsmBuildings = useStore((s) => s.mapConfig.showOsmBuildings);
    const weatherOverlay = useStore((s) => s.mapConfig.weatherOverlay);

    // Resolve runtime truth. Precedence matters: fallbackLayerId means the
    // chosen layer failed to load, so it outranks a zoom preference, which in
    // turn outranks the stored choice while the camera is close in.
    const activeLayerId = fallbackLayerId || zoomLayerId || baseLayerId;

    const currentImageryLayerRef = useRef<ImageryLayer | null>(null);
    const osmBuildingsRef = useRef<Cesium3DTileset | null>(null);
    const terrainActiveRef = useRef(false);
    const weatherLayerRef = useRef<ImageryLayer | null>(null);

    // 1. Manage Scene Mode (2D / 3D / Columbus)
    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        let targetMode = SceneMode.SCENE3D;
        if (sceneMode === 1) targetMode = SceneMode.COLUMBUS_VIEW;
        if (sceneMode === 2) targetMode = SceneMode.SCENE2D;

        if (viewer.scene.mode !== targetMode) {
            if (targetMode === SceneMode.SCENE2D) viewer.scene.morphTo2D(1.0);
            else if (targetMode === SceneMode.SCENE3D) viewer.scene.morphTo3D(1.0);
            else if (targetMode === SceneMode.COLUMBUS_VIEW) viewer.scene.morphToColumbusView(1.0);
        }
    }, [viewer, viewerReady, sceneMode]);

    // 2. Manage Imagery Layer and Google 3D Tiles
    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        let cancelled = false;

        /** The Google Photorealistic tileset, if it has been added yet. */
        function findGoogleTileset(): Cesium3DTileset | null {
            if (!viewer) return null;
            const { primitives } = viewer.scene;
            for (let i = 0; i < primitives.length; i++) {
                const p = primitives.get(i);
                // Skip the OSM buildings tileset, which is tagged on creation.
                if (p instanceof Cesium3DTileset && !(p as { _wwvOsmBuildings?: boolean })._wwvOsmBuildings) {
                    return p;
                }
            }
            return null;
        }

        async function updateImagery() {
            if (!viewer || !viewerReady || viewer.isDestroyed()) return;

            // Whatever the globe shows before imagery arrives should read as
            // unloaded terrain rather than a hole in the map.
            viewer.scene.globe.baseColor = GLOBE_BASE_COLOR;

            const isGoogle3D = activeLayerId === "google-3d";
            const tileset = findGoogleTileset();
            const outgoingLayer = currentImageryLayerRef.current;

            if (isGoogle3D) {
                // Switching TO the 3D tileset. When there IS an outgoing surface,
                // reveal the tileset and let it load while that surface keeps
                // covering the globe, so the swap has no blank frame.
                if (tileset) {
                    tileset.show = true;
                    // Only worth waiting when something is currently covering the
                    // globe. On a cold load there is nothing to protect, and
                    // waiting here would leave the globe showing through.
                    if (outgoingLayer) {
                        await waitForTiles(tileset);
                        if (cancelled || viewer.isDestroyed()) return;
                    }
                }

                // Hide the globe whether or not the tileset exists yet. On first
                // load it is still being created by useViewerInitialization, and
                // leaving the globe visible in the meantime means it z-fights the
                // tileset the moment it arrives — which rendered as pale blotches
                // across the imagery. If the tileset never loads, the failure path
                // sets fallbackLayerId, which re-runs this effect and shows the
                // globe again with real imagery.
                viewer.scene.globe.show = false;
                if (outgoingLayer) {
                    viewer.imageryLayers.remove(outgoingLayer);
                    if (currentImageryLayerRef.current === outgoingLayer) {
                        currentImageryLayerRef.current = null;
                    }
                }
                return;
            }

            // Switching TO an imagery layer. Build it BEFORE touching anything
            // visible: this await previously ran after globe.show was set true,
            // which left the globe bare for the length of the provider's network
            // round trip — the momentary blackout.
            let newLayer: ImageryLayer;
            try {
                newLayer = new ImageryLayer(await createImageryProvider(activeLayerId));
            } catch (err) {
                console.error("[useImageryManager] Failed to load imagery:", activeLayerId, err);
                try {
                    newLayer = new ImageryLayer(createOsmProvider());
                    console.warn("[useImageryManager] Loaded OSM as fallback imagery");
                } catch (fallbackErr) {
                    console.error("[useImageryManager] OSM fallback also failed:", fallbackErr);
                    return;
                }
            }
            if (cancelled || viewer.isDestroyed()) return;

            // Index 0 keeps the weather overlay on top, and leaves any outgoing
            // layer above this one so it goes on covering the surface until the
            // new tiles are in.
            viewer.imageryLayers.add(newLayer, 0);
            currentImageryLayerRef.current = newLayer;
            viewer.scene.globe.show = true;

            await waitForTiles(viewer.scene.globe);
            if (cancelled || viewer.isDestroyed()) return;

            // Retire the outgoing surface only now that the incoming one has
            // something to show.
            if (outgoingLayer) viewer.imageryLayers.remove(outgoingLayer);
            if (tileset) tileset.show = false;
        }

        updateImagery();
        return () => {
            // A fast zoom across the threshold can start a second transition
            // before the first finishes; the loser must not apply stale changes.
            cancelled = true;
        };
    }, [viewer, viewerReady, baseLayerId, fallbackLayerId, zoomLayerId]);

    // 3. Enable Cesium World Terrain for non-Google 3D mode.
    //    depthTestAgainstTerrain is already true (useViewerInitialization) and OSM 3D
    //    Buildings store absolute WGS84 heights including terrain elevation — both need
    //    real terrain. Without it the globe is a smooth ellipsoid, buildings float, and
    //    depth clipping is inaccurate. In Google 3D mode globe.show is false so the
    //    terrain provider is irrelevant; no need to tear it down on mode switch.
    const isGoogle3D = activeLayerId === "google-3d";
    const is3DMode = sceneMode === 3;

    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;
        if (isGoogle3D || !is3DMode || terrainActiveRef.current) return;

        viewer.scene.setTerrain(Terrain.fromWorldTerrain());
        terrainActiveRef.current = true;
    }, [viewer, viewerReady, isGoogle3D, is3DMode]);

    // 4. Manage OSM 3D Buildings (only in 3D mode, not with Google Photorealistic tiles)
    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;

        const shouldShow = showOsmBuildings && !isGoogle3D && is3DMode;

        if (shouldShow && !osmBuildingsRef.current) {
            let cancelled = false;
            createOsmBuildingsAsync().then((tileset) => {
                if (cancelled || !viewer || viewer.isDestroyed()) {
                    tileset.destroy();
                    return;
                }
                (tileset as any)._wwvOsmBuildings = true;
                tileset.maximumScreenSpaceError = 16;
                tileset.style = new Cesium3DTileStyle({
                    color: `color('${OSM_BUILDING_COLOR}', ${OSM_BUILDING_ALPHA})`,
                });
                viewer.scene.primitives.add(tileset);
                osmBuildingsRef.current = tileset;
            }).catch((err) => {
                console.warn("[useImageryManager] Failed to load OSM 3D Buildings:", err);
            });
            return () => { cancelled = true; };
        }

        if (!shouldShow && osmBuildingsRef.current) {
            if (!viewer.isDestroyed()) {
                viewer.scene.primitives.remove(osmBuildingsRef.current);
            }
            osmBuildingsRef.current = null;
        }
    }, [viewer, viewerReady, isGoogle3D, is3DMode, showOsmBuildings]);

    // 4. Manage Weather Overlay (semi-transparent tile layer on top of base imagery)
    useEffect(() => {
        if (!viewer || !viewerReady || viewer.isDestroyed()) return;
        if (!weatherOverlay) return;

        let layer: ImageryLayer | null = null;

        try {
            const provider = new UrlTemplateImageryProvider({
                url: `/api/weather/tile/{z}/{x}/{y}?layer=${weatherOverlay}`,
            });
            layer = new ImageryLayer(provider, { alpha: 0.6 });
        } catch (err) {
            console.warn("[useImageryManager] Failed to load weather overlay:", err);
            return;
        }

        if (viewer.isDestroyed()) return;

        viewer.imageryLayers.add(layer);
        weatherLayerRef.current = layer;

        return () => {
            if (layer && !viewer.isDestroyed()) {
                viewer.imageryLayers.remove(layer);
                if (weatherLayerRef.current === layer) {
                    weatherLayerRef.current = null;
                }
            }
        };
    }, [viewer, viewerReady, weatherOverlay]);

    return {
        isGoogle3D
    };
}
