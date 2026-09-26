/**
 * Fixed-grid tiling for place-label caching.
 *
 * Caching on the viewport itself does not work: the viewport changes with every
 * pan and zoom, so each camera move mints a new cache key and a new upstream
 * query. In practice that meant hundreds of Overpass requests from one browsing
 * session, which is abusive to volunteer infrastructure and got this client
 * throttled during development.
 *
 * Snapping to a fixed grid instead means panning inside an area is free, and
 * the number of distinct queries is bounded by geography rather than by how
 * much the user moves the camera.
 */

/**
 * Tile sizes in degrees, coarse to fine. A view picks the first size that keeps
 * its coverage small, so a wide view uses big tiles and a street-level view
 * uses small ones — the fetched area stays proportional to what is on screen.
 */
export const TILE_SIZES_DEG = [16, 8, 4, 2, 1, 0.5, 0.25] as const;

/** Never fetch more than this many tiles for one view. */
export const MAX_TILES_PER_VIEW = 4;

export interface Bbox {
    west: number;
    south: number;
    east: number;
    north: number;
}

export interface Tile {
    /** South-west corner, already snapped to the grid. */
    lat: number;
    lon: number;
    size: number;
}

/**
 * Chooses the finest tile size whose grid still covers the view in at most
 * MAX_TILES_PER_VIEW tiles.
 *
 * Finest-that-fits rather than smallest-possible: a smaller tile means less
 * wasted fetching, but too small and a single view spans many tiles, which is
 * the request amplification this exists to avoid.
 */
export function chooseTileSize(bbox: Bbox): number {
    const width = Math.abs(bbox.east - bbox.west);
    const height = Math.abs(bbox.north - bbox.south);

    for (let i = TILE_SIZES_DEG.length - 1; i >= 0; i--) {
        const size = TILE_SIZES_DEG[i];
        // +1 on each axis: a view rarely aligns to the grid, so it usually
        // straddles one extra tile in each direction.
        const across = Math.floor(width / size) + 1;
        const down = Math.floor(height / size) + 1;
        if (across * down <= MAX_TILES_PER_VIEW) return size;
    }
    return TILE_SIZES_DEG[0];
}

function snap(value: number, size: number): number {
    return Math.floor(value / size) * size;
}

/** Enumerates the tiles of a given size that a view touches. */
function tilesAtSize(bbox: Bbox, size: number): Tile[] {
    const tiles: Tile[] = [];

    const latStart = snap(Math.max(bbox.south, -90), size);
    const latEnd = snap(Math.min(bbox.north, 90), size);
    const lonStart = snap(Math.max(bbox.west, -180), size);
    const lonEnd = snap(Math.min(bbox.east, 180), size);

    for (let lat = latStart; lat <= latEnd; lat += size) {
        for (let lon = lonStart; lon <= lonEnd; lon += size) {
            tiles.push({ lat, lon, size });
            if (tiles.length >= MAX_TILES_PER_VIEW) return tiles;
        }
    }
    return tiles;
}

/** Every place tile the view touches, at the size chosen for it. */
export function tilesForBbox(bbox: Bbox): Tile[] {
    return tilesAtSize(bbox, chooseTileSize(bbox));
}

export function tileCacheKey(tile: Tile): string {
    return `map-labels:places:${tile.size}:${tile.lat.toFixed(2)}:${tile.lon.toFixed(2)}`;
}

export function tileBbox(tile: Tile): Bbox {
    return {
        west: tile.lon,
        south: tile.lat,
        east: tile.lon + tile.size,
        north: tile.lat + tile.size,
    };
}

/**
 * Tile sizes for STREET labels, which are far denser than places.
 *
 * `out geom` returns every coordinate of every way, so a street tile carries
 * orders of magnitude more data than a place tile covering the same ground.
 * These sizes are deliberately small, and street labels only render close in
 * anyway (see MAX_STREET_LABEL_HEIGHT_M), so a small tile still covers the
 * whole view.
 */
export const STREET_TILE_SIZES_DEG = [0.08, 0.04, 0.02, 0.01] as const;

export function chooseStreetTileSize(bbox: Bbox): number {
    const width = Math.abs(bbox.east - bbox.west);
    const height = Math.abs(bbox.north - bbox.south);

    for (let i = STREET_TILE_SIZES_DEG.length - 1; i >= 0; i--) {
        const size = STREET_TILE_SIZES_DEG[i];
        const across = Math.floor(width / size) + 1;
        const down = Math.floor(height / size) + 1;
        if (across * down <= MAX_TILES_PER_VIEW) return size;
    }
    return STREET_TILE_SIZES_DEG[0];
}

/** Every street tile the view touches. */
export function streetTilesForBbox(bbox: Bbox): Tile[] {
    return tilesAtSize(bbox, chooseStreetTileSize(bbox));
}

export function streetTileCacheKey(tile: Tile): string {
    return `map-labels:streets:${tile.size}:${tile.lat.toFixed(3)}:${tile.lon.toFixed(3)}`;
}
