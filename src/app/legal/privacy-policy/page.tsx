import type { Metadata } from "next";
import Link from "next/link";

import { LegalNotice } from "../LegalNotice";
import { SITE_NAME, contactEmail, formattedDate, operatorName } from "../legalConfig";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description: "How this WorldWideView instance handles personal data.",
};

export default function PrivacyPolicyPage() {
    return (
        <>
            <Link href="/login" className="legal-back">
                ← Back
            </Link>
            <h1>Privacy Policy</h1>
            <p className="legal-updated">Last updated {formattedDate()}</p>

            <LegalNotice />

            <h2>Who is responsible</h2>
            <p>
                {SITE_NAME} is an independently operated installation of WorldWideView, run by{" "}
                <strong>{operatorName()}</strong>. The operator alone decides how personal data on
                this instance is handled. WorldWideView is self-hosted software; the project that
                publishes it does not host this instance, receive its data, or act as a processor
                for it.
            </p>
            <p>
                For privacy questions or requests, contact <strong>{contactEmail()}</strong>.
            </p>

            <h2>What is collected</h2>
            <h3>Account information</h3>
            <p>When an account is created, the instance stores:</p>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Why</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Name and email address</td>
                        <td>Identifying the account and signing in</td>
                    </tr>
                    <tr>
                        <td>A one-way hash of the password</td>
                        <td>
                            Verifying sign-in. The password itself is never stored and cannot be
                            recovered from the hash.
                        </td>
                    </tr>
                    <tr>
                        <td>Role, and whether the account is suspended</td>
                        <td>Access control</td>
                    </tr>
                    <tr>
                        <td>Account created and last updated timestamps</td>
                        <td>Administration</td>
                    </tr>
                    <tr>
                        <td>Session records, and API keys where created</td>
                        <td>Keeping you signed in and authenticating programmatic access</td>
                    </tr>
                    <tr>
                        <td>Saved layer settings and favourites</td>
                        <td>Restoring your view between visits</td>
                    </tr>
                </tbody>
            </table>

            <h3>Cookies</h3>
            <p>
                A session cookie is set when you sign in. It is required for the application to
                work and is not used for advertising or cross-site tracking. Some interface
                preferences are kept in your browser&apos;s local storage and never leave your
                device.
            </p>

            <h3>Technical logs and error reports</h3>
            <p>
                Server logs may record IP addresses, request paths and timestamps, which is
                ordinary for any web server and is used for security and debugging. If the
                operator has enabled error reporting, crash diagnostics — which can include a
                stack trace, the page being viewed and browser details — are sent to the error
                tracking service the operator has configured.
            </p>

            <h3>What is not collected</h3>
            <p>
                This instance does not sell personal data, and it does not build advertising
                profiles. Advertising is only present in the project&apos;s public demo edition,
                which is a separate deployment from this one.
            </p>

            <h2>Map and layer data</h2>
            <p>
                The layers shown on the globe are fetched from third-party public data sources —
                for example OpenStreetMap, satellite catalogues, aviation and maritime feeds, and
                government camera and hazard feeds. Some are requested by your browser directly
                from the provider, which means the provider can see your IP address, in the same
                way as visiting their website. Others are fetched and cached by the server, in
                which case the provider sees only the server.
            </p>
            <p>
                Map imagery and terrain are served by the imagery provider the operator has
                configured. Searching for a place sends the text you type to a geocoding service
                so it can be resolved to coordinates.
            </p>
            <p>
                Data on surveillance infrastructure layers comes from OpenStreetMap and is
                licensed under the{" "}
                <a
                    href="https://opendatacommons.org/licenses/odbl/1-0/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open Database Licence
                </a>
                . It describes fixed equipment in public view, contributed by volunteers, and
                contains no information about individuals.
            </p>

            <h2>How long data is kept</h2>
            <p>
                Account data is kept until the account is deleted. Cached layer data is transient
                and expires automatically, typically within hours or days. Log retention is set by
                the operator.
            </p>

            <h2>Your rights</h2>
            <p>
                Depending on where you live, you may have the right to access, correct, export or
                delete your personal data, to object to certain processing, or to complain to a
                data protection authority. To exercise any of these, contact{" "}
                <strong>{contactEmail()}</strong>. Because this is a self-hosted instance, only
                the operator can action such a request.
            </p>

            <h2>Changes</h2>
            <p>
                If this policy changes, the date at the top of this page will change with it.
            </p>

            <p>
                See also the <Link href="/legal/terms-of-service">Terms of Service</Link>.
            </p>
        </>
    );
}
