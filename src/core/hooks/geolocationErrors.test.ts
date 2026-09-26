import { describe, expect, it } from "vitest";

import {
    GEO_PERMISSION_DENIED,
    GEO_POSITION_UNAVAILABLE,
    GEO_TIMEOUT,
    geolocationErrorMessage,
    geolocationUnavailableReason,
} from "./geolocationErrors";

describe("geolocationErrorMessage", () => {
    it("tells the user what to do about a denied permission", () => {
        const msg = geolocationErrorMessage(GEO_PERMISSION_DENIED);
        expect(msg).toContain("denied");
        expect(msg).toContain("browser settings");
    });

    it("distinguishes no-fix from denial and from timeout", () => {
        expect(geolocationErrorMessage(GEO_POSITION_UNAVAILABLE)).toContain("could not determine");
        expect(geolocationErrorMessage(GEO_TIMEOUT)).toContain("timed out");
        // Each case must be distinguishable; a single generic string would
        // leave the user with no idea whether retrying helps.
        const all = [GEO_PERMISSION_DENIED, GEO_POSITION_UNAVAILABLE, GEO_TIMEOUT].map(
            geolocationErrorMessage,
        );
        expect(new Set(all).size).toBe(3);
    });

    it("falls back for an unknown or missing code", () => {
        expect(geolocationErrorMessage(undefined)).toBe("Could not get your location.");
        expect(geolocationErrorMessage(99)).toBe("Could not get your location.");
    });
});

describe("geolocationUnavailableReason", () => {
    it("allows the attempt when supported and secure", () => {
        expect(geolocationUnavailableReason({ geolocation: {} }, true)).toBeNull();
    });

    it("reports an unsupported browser", () => {
        expect(geolocationUnavailableReason({}, true)).toContain("does not support");
        expect(geolocationUnavailableReason(undefined, true)).toContain("does not support");
    });

    it("names HTTPS as the blocker on an insecure origin", () => {
        // Otherwise this is indistinguishable from a denied permission.
        expect(geolocationUnavailableReason({ geolocation: {} }, false)).toContain("HTTPS");
    });

    it("attempts anyway when secure-context support is unknown", () => {
        expect(geolocationUnavailableReason({ geolocation: {} }, undefined)).toBeNull();
    });
});
