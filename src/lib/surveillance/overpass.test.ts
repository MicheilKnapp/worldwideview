import { beforeEach, describe, expect, it, vi } from "vitest";

import { OVERPASS_MIRRORS, buildQuery, fetchTier, overpassMirrors } from "./overpass";
import { TIERS } from "./tiers";

describe("overpassMirrors", () => {
    it("uses the built-in list when nothing is configured", () => {
        expect(overpassMirrors({})).toEqual([...OVERPASS_MIRRORS]);
    });

    it("honours an override and preserves its order", () => {
        const env = {
            SURVEILLANCE_OVERPASS_MIRRORS:
                "https://overpass.kumi.systems/api/interpreter, https://overpass-api.de/api/interpreter",
        };
        expect(overpassMirrors(env)).toEqual([
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter",
        ]);
    });

    it("drops non-http entries", () => {
        const env = {
            SURVEILLANCE_OVERPASS_MIRRORS: "ftp://nope, https://ok.example/api/interpreter, garbage",
        };
        expect(overpassMirrors(env)).toEqual(["https://ok.example/api/interpreter"]);
    });

    it("falls back to the defaults rather than leaving no mirrors at all", () => {
        // An override that filters down to nothing must not disable every tier.
        expect(overpassMirrors({ SURVEILLANCE_OVERPASS_MIRRORS: "garbage,,ftp://x" })).toEqual([
            ...OVERPASS_MIRRORS,
        ]);
        expect(overpassMirrors({ SURVEILLANCE_OVERPASS_MIRRORS: "" })).toEqual([...OVERPASS_MIRRORS]);
    });
});

describe("buildQuery", () => {
    it("wraps a tier selector in an nwr query returning centres", () => {
        const alpr = TIERS.find((t) => t.id === "alpr")!;
        const q = buildQuery(alpr);
        // nwr + out center, so the 700-odd surveillance ways/relations are kept.
        expect(q).toContain("nwr[");
        expect(q).toContain("out center tags;");
        expect(q).toContain('["surveillance:type"~"ALPR",i]');
        // The man_made gate was dropped: it cost the AFR tier 95% of its nodes.
        expect(q).not.toContain("man_made");
    });
});

describe("fetchTier plausibility", () => {
    const tier = TIERS.find((t) => t.id === "gunshot_detector")!;
    const body = (n: number) =>
        JSON.stringify({ elements: Array.from({ length: n }, (_, i) => ({ type: "node", id: i, lat: 0, lon: 0 })) });

    const stubFetch = (perCall: number[]) => {
        let call = 0;
        return vi.fn(async () => {
            const n = perCall[Math.min(call++, perCall.length - 1)];
            return { ok: true, status: 200, statusText: "OK", text: async () => body(n) } as Response;
        });
    };

    const twoMirrors = {
        SURVEILLANCE_OVERPASS_MIRRORS: "https://stale.example/api/interpreter,https://good.example/api/interpreter",
    };

    beforeEach(() => vi.restoreAllMocks());

    it("skips a mirror returning implausibly few elements and takes the next", async () => {
        // This is the real incident: a mirror on a stale planet extract answered
        // 200 with valid JSON and 55% of the rows, which looked like success.
        vi.stubGlobal("fetch", stubFetch([2039, 3692]));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", twoMirrors.SURVEILLANCE_OVERPASS_MIRRORS);

        const res = await fetchTier(tier, Math.floor(3690 * 0.6));
        expect(res.elements).toHaveLength(3692);
        expect(res.mirror).toBe("good.example");
        expect(res.implausible).toBe(false);
    }, 30_000);

    it("flags implausible when every mirror falls short, keeping the largest", async () => {
        vi.stubGlobal("fetch", stubFetch([1000, 2039]));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", twoMirrors.SURVEILLANCE_OVERPASS_MIRRORS);

        const res = await fetchTier(tier, Math.floor(3690 * 0.6));
        expect(res.implausible).toBe(true);
        expect(res.elements).toHaveLength(2039);
    }, 30_000);

    it("accepts any count when there is no previous sweep to compare against", async () => {
        vi.stubGlobal("fetch", stubFetch([5]));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", "https://only.example/api/interpreter");

        const res = await fetchTier(tier, 0);
        expect(res.implausible).toBe(false);
        expect(res.elements).toHaveLength(5);
    }, 30_000);
});

describe("planet freshness", () => {
    const tier = TIERS.find((t) => t.id === "gunshot_detector")!;
    const reply = (base: string | null, n = 3692) =>
        JSON.stringify({
            ...(base ? { osm3s: { timestamp_osm_base: base } } : {}),
            elements: Array.from({ length: n }, (_, i) => ({ type: "node", id: i, lat: 0, lon: 0 })),
        });
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");

    beforeEach(() => vi.restoreAllMocks());

    it("rejects a months-old extract and moves to the next mirror", async () => {
        // private.coffee answered 200 with a planet base ~117 days behind.
        let call = 0;
        vi.stubGlobal("fetch", vi.fn(async () => {
            const body = call++ === 0 ? reply(iso(117)) : reply(iso(0));
            return { ok: true, status: 200, statusText: "OK", text: async () => body } as Response;
        }));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", "https://stale.example/api/interpreter,https://fresh.example/api/interpreter");

        const res = await fetchTier(tier);
        expect(res.mirror).toBe("fresh.example");
        expect(res.implausible).toBe(false);
    }, 30_000);

    it("accepts a mirror a few hours behind", async () => {
        vi.stubGlobal("fetch", vi.fn(async () =>
            ({ ok: true, status: 200, statusText: "OK", text: async () => reply(iso(0.25)) }) as Response));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", "https://fresh.example/api/interpreter");

        await expect(fetchTier(tier)).resolves.toMatchObject({ mirror: "fresh.example" });
    }, 30_000);

    it("does not reject a response that omits the timestamp", async () => {
        // Missing field is not evidence of staleness; the count floor still applies.
        vi.stubGlobal("fetch", vi.fn(async () =>
            ({ ok: true, status: 200, statusText: "OK", text: async () => reply(null) }) as Response));
        vi.stubEnv("SURVEILLANCE_OVERPASS_MIRRORS", "https://nots.example/api/interpreter");

        await expect(fetchTier(tier)).resolves.toMatchObject({ implausible: false });
    }, 30_000);
});
