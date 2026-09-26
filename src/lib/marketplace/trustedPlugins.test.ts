import { describe, expect, it } from "vitest";

import { isSameOriginEntry } from "./trustedPlugins";

const ORIGIN = "https://wwv.example.com";

describe("isSameOriginEntry", () => {
    it("trusts a root-relative bundle the operator committed", () => {
        expect(isSameOriginEntry("/plugins/surveillance-infrastructure/frontend.mjs", ORIGIN)).toBe(true);
        expect(isSameOriginEntry("/plugins/iss/frontend.mjs", ORIGIN)).toBe(true);
        expect(isSameOriginEntry("./frontend.mjs", ORIGIN)).toBe(true);
    });

    it("trusts an absolute URL on the same origin", () => {
        expect(isSameOriginEntry(`${ORIGIN}/plugins/x/frontend.mjs`, ORIGIN)).toBe(true);
    });

    it("does not trust third-party CDN bundles", () => {
        // These are what the gate exists for.
        expect(isSameOriginEntry("https://unpkg.com/@worldwideview/wwv-plugin-aviation@1.0.21/dist/frontend.mjs", ORIGIN)).toBe(false);
        expect(isSameOriginEntry("https://cdn.jsdelivr.net/npm/x/frontend.mjs", ORIGIN)).toBe(false);
    });

    it("does not trust a protocol-relative entry that only looks relative", () => {
        // The whole reason this resolves through new URL() instead of
        // entry.startsWith("/"): these begin with a slash but point elsewhere.
        expect(isSameOriginEntry("//evil.example/x.mjs", ORIGIN)).toBe(false);
        expect(isSameOriginEntry("//unpkg.com/x/frontend.mjs", ORIGIN)).toBe(false);
    });

    it("distinguishes a different host, port and scheme", () => {
        expect(isSameOriginEntry("https://other.example.com/x.mjs", ORIGIN)).toBe(false);
        expect(isSameOriginEntry("https://wwv.example.com:8443/x.mjs", ORIGIN)).toBe(false);
        expect(isSameOriginEntry("http://wwv.example.com/x.mjs", ORIGIN)).toBe(false);
    });

    it("is false for missing or unparseable input", () => {
        expect(isSameOriginEntry(undefined, ORIGIN)).toBe(false);
        expect(isSameOriginEntry("", ORIGIN)).toBe(false);
        expect(isSameOriginEntry("/x.mjs", undefined)).toBe(false);
        expect(isSameOriginEntry("/x.mjs", "not a url")).toBe(false);
        expect(isSameOriginEntry("http://[bad", ORIGIN)).toBe(false);
    });
});
