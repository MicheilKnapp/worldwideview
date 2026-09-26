import type { GeoEntity } from "@/core/plugins/PluginTypes";

/**
 * Coordinate validation for entities arriving from plugins.
 *
 * Plugin bundles are third-party code loaded at runtime, so the host cannot
 * assume their output is well-formed. Cesium's `Cartesian3.fromDegrees` throws
 * a DeveloperError on a non-numeric coordinate, and because rendering happens
 * inside a React effect that error unmounts the whole globe — one malformed
 * entity from one layer takes down every layer.
 *
 * A real case: the aviation bundle's `mapWebsocketPayload` handed the engine's
 * `{source, fetchedAt, items, totalCount}` envelope to a mapper whose non-array
 * branch does `Object.values(payload)`. That yielded four rows — two strings,
 * the items array, and a count — each mapped to an entity with `latitude` and
 * `longitude` undefined.
 */
export function isRenderableEntity(entity: GeoEntity | null | undefined): boolean {
    if (!entity) return false;
    const { latitude, longitude } = entity;
    if (typeof latitude !== "number" || typeof longitude !== "number") return false;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    // Out-of-range values do not throw, but they place entities at nonsense
    // positions, which is harder to notice than a crash.
    if (latitude < -90 || latitude > 90) return false;
    if (longitude < -180 || longitude > 180) return false;
    return true;
}

/**
 * Splits a batch into renderable entities and a count of what was dropped.
 * Returns the original array when everything is valid, so the common path
 * allocates nothing.
 */
export function partitionRenderable(entities: GeoEntity[]): {
    valid: GeoEntity[];
    dropped: number;
} {
    let firstBadIndex = -1;
    for (let i = 0; i < entities.length; i++) {
        if (!isRenderableEntity(entities[i])) {
            firstBadIndex = i;
            break;
        }
    }
    if (firstBadIndex === -1) return { valid: entities, dropped: 0 };

    const valid = entities.slice(0, firstBadIndex);
    for (let i = firstBadIndex + 1; i < entities.length; i++) {
        if (isRenderableEntity(entities[i])) valid.push(entities[i]);
    }
    return { valid, dropped: entities.length - valid.length };
}
