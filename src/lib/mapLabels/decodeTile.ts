import { VectorTile } from "@mapbox/vector-tile";
// pbf v5 exports PbfReader and has no default export; VectorTile
// expects exactly this type.
import { PbfReader } from "pbf";

import { LABELLED_KINDS, type PlaceKind, type PlaceLabel } from "./places";
import { LABELLED_HIGHWAYS, type HighwayClass, type StreetWay } from "./streets";
import { simplifyPolyline } from "./simplify";
import type { TileCoord } from "./pmtilesSource";

/**
 * Decodes Protomaps vector tiles into the types the label pipeline already uses.
 *
 * This is the whole adapter between the new data source and everything
 * downstream: selectVisiblePlaces, selectStreetLabels, clipToView, anchorsAlong
 * and the billboard rotation are untouched, because this produces exactly the
 * PlaceLabel and StreetWay shapes they consumed from Overpass.
 *
 * Two schema differences worth knowing. Protomaps names its layers `places` and
 * `roads`, and it describes feature types with `kind` / `kind_detail` rather
 * than raw OSM tags — so `kind_detail` is what maps onto PlaceKind and
 * HighwayClass. It also ships `population_rank`, a precomputed significance
 * ordering that OSM's raw `population` tag does not provide.
 */

/** Protomaps basemap layer holding city and town labels. */
const PLACES_LAYER = "places";
/** Protomaps basemap layer holding named linear transport features. */
const ROADS_LAYER = "roads";

interface TileFeatureLike {
    properties: Record<string, unknown>;
    toGeoJSON(x: number, y: number, z: number): {
        geometry: { type: string; coordinates: unknown };
    };
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

/**
 * The name to label a feature with.
 *
 * Protomaps carries localised names as `name:en` and similar alongside `name`.
 * Preferring the plain `name` keeps endonyms, which is what a map of a place
 * normally shows, and falls back to English only when there is no local name.
 */
export function featureName(props: Record<string, unknown>): string | null {
    return asString(props.name) ?? asString(props["name:en"]);
}

/**
 * Maps a Protomaps place onto PlaceKind.
 *
 * `kind_detail` carries the specific type (city, town, village); `kind` is
 * broader (locality, neighbourhood). Detail is tried first so a `locality` is
 * ranked as the city or town it actually is rather than lumped together.
 */
export function placeKindOf(props: Record<string, unknown>): PlaceKind | null {
    const detail = asString(props.kind_detail);
    if (detail && (LABELLED_KINDS as string[]).includes(detail)) return detail as PlaceKind;
    const kind = asString(props.kind);
    if (kind && (LABELLED_KINDS as string[]).includes(kind)) return kind as PlaceKind;
    return null;
}

export function highwayKindOf(props: Record<string, unknown>): HighwayClass | null {
    const detail = asString(props.kind_detail);
    if (detail && (LABELLED_HIGHWAYS as string[]).includes(detail)) return detail as HighwayClass;
    const kind = asString(props.kind);
    if (kind && (LABELLED_HIGHWAYS as string[]).includes(kind)) return kind as HighwayClass;
    return null;
}

/**
 * Significance for tie-breaking, from population where present.
 *
 * `population_rank` is a small ordinal where higher means more significant, so
 * it is scaled into the same space as a population count. That keeps
 * selectVisiblePlaces' existing `population` comparison working unchanged while
 * benefiting from the better signal.
 */
export function significanceOf(props: Record<string, unknown>): number {
    const population = asNumber(props.population);
    if (population > 0) return population;
    const rank = asNumber(props.population_rank);
    return rank > 0 ? rank * 1_000 : 0;
}

/** Decodes the place labels in one tile. */
export function decodePlaces(data: ArrayBuffer, coord: TileCoord): PlaceLabel[] {
    const tile = new VectorTile(new PbfReader(new Uint8Array(data)));
    const layer = tile.layers[PLACES_LAYER];
    if (!layer) return [];

    const places: PlaceLabel[] = [];
    for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i) as unknown as TileFeatureLike;
        const props = feature.properties ?? {};

        const name = featureName(props);
        const kind = placeKindOf(props);
        if (!name || !kind) continue;

        // toGeoJSON converts tile-local coordinates to lon/lat for us.
        const geo = feature.toGeoJSON(coord.x, coord.y, coord.z);
        if (geo.geometry.type !== "Point") continue;
        const [lon, lat] = geo.geometry.coordinates as [number, number];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

        places.push({
            // Tile-scoped so the same place appearing in two tiles dedupes.
            id: `${name}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
            name,
            lat,
            lon,
            kind,
            population: significanceOf(props),
        });
    }
    return places;
}

/** Decodes the named roads in one tile. */
export function decodeStreets(data: ArrayBuffer, coord: TileCoord): StreetWay[] {
    const tile = new VectorTile(new PbfReader(new Uint8Array(data)));
    const layer = tile.layers[ROADS_LAYER];
    if (!layer) return [];

    const ways: StreetWay[] = [];
    for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i) as unknown as TileFeatureLike;
        const props = feature.properties ?? {};

        const name = featureName(props);
        const kind = highwayKindOf(props);
        if (!name || !kind) continue;

        const geo = feature.toGeoJSON(coord.x, coord.y, coord.z);
        const { type, coordinates } = geo.geometry;

        // A road arrives as a LineString, or a MultiLineString where the tile
        // boundary split it. Each part is labelled independently; grouping by
        // name in selectStreetLabels stitches the street back together.
        const lines: [number, number][][] =
            type === "LineString"
                ? [coordinates as [number, number][]]
                : type === "MultiLineString"
                  ? (coordinates as [number, number][][])
                  : [];

        for (let part = 0; part < lines.length; part++) {
            const coords = lines[part].filter(
                ([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat),
            );
            if (coords.length < 2) continue;
            ways.push({
                id: `${coord.z}/${coord.x}/${coord.y}:${i}:${part}`,
                name,
                kind,
                // Vector tiles are already generalised per zoom, but a z15 road
                // still carries more vertices than a label needs.
                coords: simplifyPolyline(coords),
            });
        }
    }
    return ways;
}
