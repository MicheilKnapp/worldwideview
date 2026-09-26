/**
 * Operator-specific details for the legal pages.
 *
 * WorldWideView is self-hosted, so the data controller is whoever runs the
 * instance — not the project. These values therefore come from the environment
 * rather than being hardcoded, and the pages state plainly when they have not
 * been set, so an unconfigured instance cannot quietly present an incomplete
 * document as if it were finished.
 */

/** Name of the person or entity operating this instance. */
export const OPERATOR = process.env.NEXT_PUBLIC_LEGAL_OPERATOR?.trim() || "";
/** Contact address for privacy requests and legal notices. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "";
/** Governing jurisdiction, e.g. "the State of New York, United States". */
export const JURISDICTION = process.env.NEXT_PUBLIC_LEGAL_JURISDICTION?.trim() || "";
/** Public hostname, used in the documents to name the service. */
export const SITE_NAME = process.env.NEXT_PUBLIC_LEGAL_SITE_NAME?.trim() || "this instance";

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
