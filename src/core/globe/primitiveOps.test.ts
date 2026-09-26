import { Color } from "cesium";
import { describe, expect, it } from "vitest";

import type { CesiumEntityOptions } from "@/core/plugins/PluginTypes";
import { resolveBillboardTint } from "./primitiveOps";

/** The value getEntityColor() yields when a plugin sets no colour. */
const CYAN_DEFAULT = Color.CYAN;

const opts = (o: Partial<CesiumEntityOptions> & Record<string, unknown>) =>
    ({ type: "billboard", ...o }) as CesiumEntityOptions;

describe("resolveBillboardTint", () => {
    it("does not tint a host-generated dot", () => {
        // The colour is already baked into the generated SVG; tinting would square it.
        const tint = resolveBillboardTint(
            opts({ iconUrl: "data:image/svg+xml,dot", color: "#ff0000", _isAutoSVG: true }),
            Color.RED,
        );
        expect(tint).toBe(Color.WHITE);
    });

    it("does not tint a plugin icon that asked for no colour", () => {
        // Previously this applied the CYAN fallback, recolouring pre-coloured
        // artwork so it matched nothing in the plugin's own legend.
        const tint = resolveBillboardTint(
            opts({ iconUrl: "data:image/svg+xml,custom" }),
            CYAN_DEFAULT,
        );
        expect(tint).toBe(Color.WHITE);
    });

    it("applies the tint a plugin explicitly asked for", () => {
        const tint = resolveBillboardTint(
            opts({ iconUrl: "data:image/svg+xml,white-art", color: "#ffb020" }),
            Color.ORANGE,
        );
        expect(tint).toBe(Color.ORANGE);
    });

    it("still tints when there is no icon at all", () => {
        // No iconUrl and not auto-SVG: nothing has baked colour, so the
        // resolved colour must survive.
        expect(resolveBillboardTint(opts({ color: "#00ff00" }), Color.LIME)).toBe(Color.LIME);
        expect(resolveBillboardTint(opts({}), CYAN_DEFAULT)).toBe(CYAN_DEFAULT);
    });
});
