/**
 * Renders a street name to a canvas texture.
 *
 * Cesium's Label has no rotation property — only Billboard does — so text that
 * has to follow a road's on-screen direction cannot be a Label at all. It is
 * drawn to a canvas once per name and used as a billboard image, which can be
 * rotated freely.
 *
 * Textures are cached by name and style: a street is usually labelled several
 * times along its length, and every tile in view tends to repeat the same
 * handful of road names.
 */

export interface TextTexture {
    url: string;
    /** CSS pixels, i.e. already divided back down from the device ratio. */
    width: number;
    height: number;
}

const cache = new Map<string, TextTexture>();

const FONT_PX = 13;
const FONT = `600 ${FONT_PX}px Inter, system-ui, sans-serif`;
const PAD_X = 6;
const PAD_Y = 3;
const OUTLINE_PX = 3;

/**
 * @param text The street name.
 * @param pixelRatio Device pixel ratio, so the texture is crisp on retina
 *   screens rather than upscaled from a CSS-pixel canvas.
 */
export function textTexture(text: string, pixelRatio = 1): TextTexture | null {
    if (typeof document === "undefined" || !text) return null;

    const ratio = Math.min(Math.max(pixelRatio, 1), 3);
    const key = `${text}::${ratio}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.font = FONT;
    const metrics = ctx.measureText(text);
    const width = Math.ceil(metrics.width) + PAD_X * 2;
    const height = FONT_PX + PAD_Y * 2 + OUTLINE_PX;

    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);

    // Re-apply after resizing: setting width/height resets the context.
    ctx.scale(ratio, ratio);
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Outline under fill, so the name stays readable over photography of any
    // brightness — a white roof and dark water in the same view.
    ctx.lineWidth = OUTLINE_PX;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(text, width / 2, height / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, width / 2, height / 2);

    const texture: TextTexture = { url: canvas.toDataURL("image/png"), width, height };
    cache.set(key, texture);
    return texture;
}

/** Test seam; also lets a theme change drop stale textures. */
export function clearTextTextureCache(): void {
    cache.clear();
}

export function textTextureCacheSize(): number {
    return cache.size;
}
