import type { ReactNode } from "react";

import "./legal.css";

/**
 * Shell for the legal documents. Deliberately plain: these pages must be
 * readable by someone who has not signed in and is deciding whether to.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
    return (
        <div className="legal-page">
            <article className="legal-doc">{children}</article>
        </div>
    );
}
