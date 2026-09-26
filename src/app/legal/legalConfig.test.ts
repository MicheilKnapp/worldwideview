import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = [
    "LEGAL_OPERATOR",
    "LEGAL_CONTACT_EMAIL",
    "LEGAL_JURISDICTION",
] as const;

describe("legalConfig", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        vi.resetModules();
        for (const k of KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it("is unconfigured when nothing is set, and says so via placeholders", async () => {
        const m = await import("./legalConfig");
        expect(m.IS_CONFIGURED).toBe(false);
        // Placeholders must read as placeholders, never as a real party.
        expect(m.operatorName()).toBe("the operator of this instance");
        expect(m.contactEmail()).toBe("the operator of this instance");
        expect(m.jurisdiction()).toBe("the operator's jurisdiction");
    });

    it("stays unconfigured when a value is only whitespace", async () => {
        process.env.LEGAL_OPERATOR = "  ";
        process.env.LEGAL_CONTACT_EMAIL = "legal@example.test";
        process.env.LEGAL_JURISDICTION = "Nowhere";
        const m = await import("./legalConfig");
        expect(m.IS_CONFIGURED).toBe(false);
    });

    it("is unconfigured until every value is present", async () => {
        process.env.LEGAL_OPERATOR = "Example Operator";
        const partial = await import("./legalConfig");
        expect(partial.IS_CONFIGURED).toBe(false);
        expect(partial.operatorName()).toBe("Example Operator");
    });

    it("is configured once all three are set", async () => {
        process.env.LEGAL_OPERATOR = "Example Operator";
        process.env.LEGAL_CONTACT_EMAIL = "legal@example.test";
        process.env.LEGAL_JURISDICTION = "the State of Example";
        const m = await import("./legalConfig");
        expect(m.IS_CONFIGURED).toBe(true);
        expect(m.operatorName()).toBe("Example Operator");
        expect(m.contactEmail()).toBe("legal@example.test");
        expect(m.jurisdiction()).toBe("the State of Example");
    });

    it("formats the last-updated date stably in UTC", async () => {
        const m = await import("./legalConfig");
        expect(m.formattedDate()).toBe("26 September 2026");
    });
});

describe("age constants", () => {
    it("matches the answers the documents are written against", async () => {
        const m = await import("./legalConfig");
        // 13 is the COPPA floor; 16 is the GDPR Art. 8 default, and the terms
        // require parental authorisation between the two.
        expect(m.MIN_AGE).toBe(13);
        expect(m.EU_CONSENT_AGE).toBe(16);
        expect(m.MIN_AGE).toBeLessThan(m.EU_CONSENT_AGE);
    });
});
