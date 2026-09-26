import Link from "next/link";

/**
 * Legal links shown on every page.
 *
 * Defaults to this instance's OWN pages. A self-hosted deployment's data
 * controller is whoever runs it, so the project's cloud documents do not
 * describe it, and pointing there would misstate who is responsible.
 *
 * `NEXT_PUBLIC_LEGAL_URL` overrides with an external base for operators who
 * publish their own documents elsewhere.
 *
 * Note `||`, not `??`: a blank environment variable — what an empty field in a
 * deployment UI produces — must fall back to the default. `??` only catches
 * null and undefined, so a blank value previously survived and produced
 * relative hrefs like "/privacy-policy" against routes that did not exist.
 */
const EXTERNAL_BASE = process.env.NEXT_PUBLIC_LEGAL_URL?.trim() || "";
const USE_EXTERNAL = EXTERNAL_BASE.length > 0;

/** External bases keep the project's published path names. */
const PRIVACY_HREF = USE_EXTERNAL ? `${EXTERNAL_BASE}/privacy-policy` : "/legal/privacy-policy";
const TERMS_HREF = USE_EXTERNAL
    ? `${EXTERNAL_BASE}/cloud-terms-of-service`
    : "/legal/terms-of-service";

export function LegalFooter() {
    if (USE_EXTERNAL) {
        return (
            <footer className="legal-footer">
                <a href={PRIVACY_HREF} target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                </a>
                <a href={TERMS_HREF} target="_blank" rel="noopener noreferrer">
                    Terms of Service
                </a>
            </footer>
        );
    }

    return (
        <footer className="legal-footer">
            <Link href={PRIVACY_HREF}>Privacy Policy</Link>
            <Link href={TERMS_HREF}>Terms of Service</Link>
        </footer>
    );
}
