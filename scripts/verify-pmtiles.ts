/**
 * Runs the real label pipeline against a real PMTiles archive.
 *
 * Unit tests cover the decode logic against synthetic tiles, which cannot catch
 * the things most likely to be wrong: whether Protomaps actually names its
 * layers `places` and `roads`, and whether its `kind` / `kind_detail` values
 * match LABELLED_KINDS and LABELLED_HIGHWAYS. Only real data shows that.
 *
 *   PMTILES_ARCHIVES=/path/to/test.pmtiles node node_modules/tsx/dist/cli.mjs \
 *     local-scripts/verify-pmtiles.ts
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

import { fetchPlacesFromTiles, fetchStreetsFromTiles, zoomForBbox } from "@/lib/mapLabels/fetchFromTiles";
import { getVectorTile, isPmtilesConfigured } from "@/lib/mapLabels/pmtilesSource";
import { selectVisiblePlaces } from "@/lib/mapLabels/places";
import { selectStreetLabels } from "@/lib/mapLabels/streets";

// Downtown San Francisco: dense, well mapped, and in every tier.
const BBOX = { west: -122.43, south: 37.76, east: -122.39, north: 37.79 };

async function main() {
    if (!isPmtilesConfigured()) {
        console.error("PMTILES_ARCHIVES is not set");
        process.exit(1);
    }

    // 1. What is actually IN a tile, before any of our mapping runs.
    const z = zoomForBbox(BBOX, 14);
    const probe = await getVectorTile({ z, x: 0, y: 0 });
    console.log(`\nzoomForBbox -> z${z}`);

    const centreZ = Math.min(z, 14);
    const n = 2 ** centreZ;
    const lon = (BBOX.west + BBOX.east) / 2;
    const lat = (BBOX.south + BBOX.north) / 2;
    const latRad = (lat * Math.PI) / 180;
    const coord = {
        z: centreZ,
        x: Math.floor(((lon + 180) / 360) * n),
        y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
    };
    const tile = await getVectorTile(coord);
    if (!tile) {
        console.error(`no tile at ${coord.z}/${coord.x}/${coord.y} (probe: ${probe ? "ok" : "none"})`);
        process.exit(1);
    }
    // Print the tile that ANSWERED, not the one requested. They differ whenever
    // a coarser archive serves the request, and conflating the two is exactly
    // how every feature ended up thousands of degrees off the map.
    const served = tile.coord;
    console.log(
        `requested ${coord.z}/${coord.x}/${coord.y}, served ${served.z}/${served.x}/${served.y}` +
            ` from ${tile.archive}, ${tile.data.byteLength} bytes`,
    );

    const raw = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
    console.log("\nlayers present:");
    for (const [name, layer] of Object.entries(raw.layers)) {
        console.log(`  ${name.padEnd(18)} ${layer.length} features`);
    }

    for (const layerName of ["places", "roads"]) {
        const layer = raw.layers[layerName];
        if (!layer) {
            console.log(`\n!! layer "${layerName}" MISSING -- decode will return nothing`);
            continue;
        }
        const kinds = new Map<string, number>();
        for (let i = 0; i < layer.length; i++) {
            const p = layer.feature(i).properties as Record<string, unknown>;
            const key = `${p.kind ?? "-"} / ${p.kind_detail ?? "-"}`;
            kinds.set(key, (kinds.get(key) ?? 0) + 1);
        }
        console.log(`\n${layerName}: kind / kind_detail seen`);
        for (const [k, c] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
            console.log(`  ${String(c).padStart(5)}  ${k}`);
        }
    }

    // 2. The pipeline end to end.
    const places = await fetchPlacesFromTiles(BBOX);
    const ways = await fetchStreetsFromTiles(BBOX);
    console.log(`\nfetchPlacesFromTiles -> ${places?.length ?? "null"}`);
    console.log(`fetchStreetsFromTiles -> ${ways?.length ?? "null"}`);

    if (places?.length) {
        const visible = selectVisiblePlaces(places, 50_000);
        console.log(`selectVisiblePlaces @50km -> ${visible.length}`);
        for (const p of visible.slice(0, 6)) console.log(`  ${p.kind.padEnd(12)} ${p.name}`);
    }
    if (ways?.length) {
        const anchors = selectStreetLabels(ways, 1_500, 80, BBOX);
        console.log(`selectStreetLabels @1.5km -> ${anchors.length} anchors`);
        const names = [...new Set(anchors.map((a) => a.name))];
        console.log(`  ${names.length} distinct names: ${names.slice(0, 10).join(", ")}`);
    }

    if (!places?.length && !ways?.length) {
        console.error("\nFAIL: archive read but nothing decoded");
        process.exit(1);
    }
    console.log("\nOK");
}

void main();
