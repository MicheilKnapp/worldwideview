import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("LegalFooter", () => {
    const original = process.env.NEXT_PUBLIC_LEGAL_URL;

    beforeEach(() => vi.resetModules());
    afterEach(() => {
        if (original === undefined) delete process.env.NEXT_PUBLIC_LEGAL_URL;
        else process.env.NEXT_PUBLIC_LEGAL_URL = original;
    });

    const renderFooter = async () => {
        const { LegalFooter } = await import("./LegalFooter");
        render(<LegalFooter />);
    };

    it("links to this instance's own pages when nothing is configured", async () => {
        delete process.env.NEXT_PUBLIC_LEGAL_URL;
        await renderFooter();
        expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/legal/privacy-policy");
        expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe("/legal/terms-of-service");
    });

    it("falls back to the local pages when the variable is blank", async () => {
        // A blank field in a deployment UI arrives as "", which `??` would pass
        // through — producing relative hrefs against routes that do not exist.
        process.env.NEXT_PUBLIC_LEGAL_URL = "";
        await renderFooter();
        expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/legal/privacy-policy");
    });

    it("falls back when the variable is only whitespace", async () => {
        process.env.NEXT_PUBLIC_LEGAL_URL = "   ";
        await renderFooter();
        expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/legal/privacy-policy");
    });

    it("uses an external base when one is configured", async () => {
        process.env.NEXT_PUBLIC_LEGAL_URL = "https://example.test/legal";
        await renderFooter();
        const privacy = screen.getByRole("link", { name: "Privacy Policy" });
        expect(privacy.getAttribute("href")).toBe("https://example.test/legal/privacy-policy");
        // External links open in a new tab and must not leak the referrer chain.
        expect(privacy.getAttribute("target")).toBe("_blank");
        expect(privacy.getAttribute("rel")).toBe("noopener noreferrer");
        expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe("https://example.test/legal/cloud-terms-of-service");
    });
});
