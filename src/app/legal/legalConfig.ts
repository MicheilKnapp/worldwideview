/**
 * Operator-specific details for the legal pages.
 *
 * WorldWideView is self-hosted, so the data controller is whoever runs the
 * instance — not the project. These values therefore come from the environment
 * rather than being hardcoded, and the pages state plainly when they have not
 * been set, so an unconfigured instance cannot quietly present an incomplete
 * document as if it were finished.
 *
 * Deliberately NOT prefixed NEXT_PUBLIC_: the legal pages are server
 * components, so these are read at request time. A prefixed variable is inlined
 * at build time, which would mean a Docker rebuild every time a contact address
 * or governing jurisdiction changed.
 */

/** Name of the person or entity operating this instance. */
export const OPERATOR = process.env.LEGAL_OPERATOR?.trim() || "";
/** Contact address for privacy requests and legal notices. */
export const CONTACT_EMAIL = process.env.LEGAL_CONTACT_EMAIL?.trim() || "";
/** Governing jurisdiction, e.g. "the State of New York, United States". */
export const JURISDICTION = process.env.LEGAL_JURISDICTION?.trim() || "";
/** Public hostname, used in the documents to name the service. */
export const SITE_NAME = process.env.LEGAL_SITE_NAME?.trim() || "this instance";

/**
 * Minimum age to hold an account. 13 is the COPPA floor in the US; EU/UK
 * visitors between 13 and 16 need parental authorisation under GDPR Art. 8,
 * which the terms state explicitly.
 */
export const MIN_AGE = 13;
/** Age below which GDPR Art. 8 requires parental authorisation. */
export const EU_CONSENT_AGE = 16;

/** ISO date the wording last changed. Bump when editing the pages. */
export const LAST_UPDATED = "2026-09-26";

export const IS_CONFIGURED = Boolean(OPERATOR && CONTACT_EMAIL && JURISDICTION);

export function operatorName(): string {
    return OPERATOR || "the operator of this instance";
}

export function contactEmail(): string {
    return CONTACT_EMAIL || "the operator of this instance";
}

export function jurisdiction(): string {
    return JURISDICTION || "the operator's jurisdiction";
}

export function formattedDate(): string {
    return new Date(`${LAST_UPDATED}T00:00:00Z`).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    });
}
