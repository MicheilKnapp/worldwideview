import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * jsdom ships no 2D canvas context, so textTexture() would correctly return
 * null and the tests would assert nothing. Stubbing the context keeps the
 * subject under test my sizing and caching logic rather than the browser's
 * text rasteriser, which is not mine to verify.
 */
function stubCanvas() {
    const ctx = {
        font: "",
        textAlign: "",
        textBaseline: "",
        lineWidth: 0,
        lineJoin: "",
        strokeStyle: "",
        fillStyle: "",
        scale: vi.fn(),
        strokeText: vi.fn(),
        fillText: vi.fn(),
        // Proportional to length, which is all the sizing logic depends on.
        measureText: (t: string) => ({ width: t.length * 7 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
        "data:image/png;base64,stub",
    );
}

import { clearTextTextureCache, textTexture, textTextureCacheSize } from "./textTexture";

describe("textTexture", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        clearTextTextureCache();
        stubCanvas();
    });

    it("produces a data URL sized to the text", () => {
        const a = textTexture("Main Street");
        expect(a).not.toBeNull();
        expect(a!.url.startsWith("data:image/")).toBe(true);
        expect(a!.width).toBeGreaterThan(0);
        expect(a!.height).toBeGreaterThan(0);
    });

    it("gives a longer name a wider texture", () => {
        const short = textTexture("Elm St");
        const long = textTexture("Kingsway Boulevard Extension");
        expect(long!.width).toBeGreaterThan(short!.width);
        // Height is set by the font, so it should not vary with length.
        expect(long!.height).toBe(short!.height);
    });

    it("caches by name, since one street is labelled repeatedly", () => {
        textTexture("Main Street");
        textTexture("Main Street");
        expect(textTextureCacheSize()).toBe(1);
    });

    it("caches separately per pixel ratio", () => {
        // A retina texture is a different bitmap; sharing one would render
        // blurry on the higher-density screen.
        textTexture("Main Street", 1);
        textTexture("Main Street", 2);
        expect(textTextureCacheSize()).toBe(2);
    });

    it("reports the same CSS size regardless of pixel ratio", () => {
        // The bitmap is denser at ratio 2, but the on-screen size must not
        // change, or names would be twice as large on a retina display.
        const one = textTexture("Main Street", 1);
        const two = textTexture("Main Street", 2);
        expect(two!.width).toBe(one!.width);
        expect(two!.height).toBe(one!.height);
    });

    it("returns null for empty text", () => {
        expect(textTexture("")).toBeNull();
    });
});
