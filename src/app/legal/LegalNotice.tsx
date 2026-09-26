import { IS_CONFIGURED } from "./legalConfig";

/**
 * Warns that this document is incomplete until the operator details are set.
 *
 * Renders nothing once LEGAL_OPERATOR, _CONTACT_EMAIL and
 * _JURISDICTION are all configured, so a finished instance shows a clean page.
 */
export function LegalNotice() {
    if (IS_CONFIGURED) return null;
    return (
        <div className="legal-notice" role="note">
            <strong>This document is not finished.</strong> The operator has not set{" "}
            <code>LEGAL_OPERATOR</code>, <code>LEGAL_CONTACT_EMAIL</code>{" "}
            and <code>LEGAL_JURISDICTION</code>, so the responsible party, contact
            address and governing law below are placeholders. It is a starting template and has
            not been reviewed by a lawyer.
        </div>
    );
}
