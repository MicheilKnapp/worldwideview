import type { Metadata } from "next";
import Link from "next/link";

import { LegalNotice } from "../LegalNotice";
import {
    EU_CONSENT_AGE,
    MIN_AGE,
    SITE_NAME,
    contactEmail,
    formattedDate,
    operatorName,
} from "../legalConfig";

/**
 * Rendered per request, not prerendered.
 *
 * The operator details come from plain (unprefixed) environment variables, which
 * exist only at container runtime -- they are in the compose `environment:`
 * block, not in build args. A static prerender would read them at BUILD time,
 * find them unset, and bake the "this document is not finished" notice into the
 * shipped HTML while the values were in fact configured.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description: "What this WorldWideView instance collects, and what it does not.",
};

export default function PrivacyPolicyPage() {
    return (
        <>
            <Link href="/login" className="legal-back">
                &larr; Back
            </Link>
            <h1>Privacy Policy</h1>
            <p className="legal-updated">Last updated {formattedDate()}</p>

            <LegalNotice />

            <h2>The short version</h2>
            <p>
                This service collects as little personal data as it can. The only personal data it
                asks for is what an account needs: a name, an email address and a password. There
                is no analytics, no error-reporting telemetry, no advertising and no tracking.
                Nothing is sold, and nothing is shared with anyone for their own purposes.
            </p>
            <p>
                If you would rather provide nothing at all, use <strong>Continue as Guest</strong>{" "}
                on the sign-in page. A guest session still creates a temporary database record, for
                the reasons set out below, but you are never asked for an email address or a
                password.
            </p>

            <h2>Who is responsible</h2>
            <p>
                {SITE_NAME} is an independently operated installation of WorldWideView, run by{" "}
                <strong>{operatorName()}</strong> (&quot;the operator&quot;), who is the data
                controller. WorldWideView is self-hosted software: the project that publishes it
                does not host this instance, does not receive its data, and is not a processor for
                it.
            </p>
            <p>
                Privacy questions and requests go to <strong>{contactEmail()}</strong>. Only the
                operator can action them.
            </p>

            <h2>What is collected</h2>

            <h3>Registered accounts</h3>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Why it exists</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Name and email address</td>
                        <td>Identifying the account and signing in</td>
                    </tr>
                    <tr>
                        <td>A one-way hash of your password</td>
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
                        <td>Created and last-updated timestamps</td>
                        <td>Administration</td>
                    </tr>
                    <tr>
                        <td>Session records, and API keys if you create any</td>
                        <td>Keeping you signed in; authenticating programmatic access</td>
                    </tr>
                    <tr>
                        <td>Your layer settings and favourites</td>
                        <td>Restoring your view between visits</td>
                    </tr>
                </tbody>
            </table>
            <p>
                Your email address is not used for marketing. There is no mailing list.
            </p>

            <h3>Guest sessions</h3>
            <p>
                Choosing <strong>Continue as Guest</strong> signs you in without asking for
                anything. To be straightforward about what that does: the software still creates a
                real but temporary account record, because favourites, settings and layer access
                all work through an account. That record holds a randomly generated identifier, a
                placeholder email address the software invents for itself, the display name
                &quot;Guest&quot;, and timestamps. You provide none of it.
            </p>
            <p>
                Guest records are deleted automatically once their session has expired. Sessions
                last seven days.
            </p>

            <h3>Cookies and local storage</h3>
            <p>
                A session cookie is set when you sign in, including as a guest. It is strictly
                necessary for the service to function and is not used for advertising or
                cross-site tracking. Some interface preferences &mdash; a collapsed panel, a chosen
                tab &mdash; are kept in your browser&apos;s local storage and never leave your
                device.
            </p>
            <p>There are no third-party cookies.</p>

            <h3>Server logs</h3>
            <p>
                The web server records ordinary request information, which can include IP
                addresses, request paths, timestamps and error details. This keeps the service
                running and secure. Retention follows the hosting platform&apos;s defaults rather
                than a period set by the operator, and these logs are not used to build any profile
                of you.
            </p>

            <h2>What is not collected</h2>
            <ul>
                <li>No analytics or page-view tracking.</li>
                <li>No third-party error-reporting or crash telemetry.</li>
                <li>
                    No advertising and no advertising identifiers. Advertising exists only in the
                    project&apos;s separate public demo edition, which is not this instance.
                </li>
                <li>
                    No location data beyond the map view you choose to look at, which is not
                    recorded.
                </li>
                <li>Nothing is sold, shared or disclosed for anyone else&apos;s purposes.</li>
            </ul>

            <h2>Map and layer data</h2>
            <p>
                The layers drawn on the globe come from third-party public sources &mdash;
                OpenStreetMap, satellite catalogues, aviation and maritime feeds, government camera
                and hazard feeds, and similar.
            </p>
            <ul>
                <li>
                    Some layers are fetched by the server and cached, so the provider sees only the
                    server.
                </li>
                <li>
                    Others, including map imagery and terrain, are requested by your browser
                    directly from the provider. Those providers can therefore see your IP address
                    and request details, exactly as if you had visited their own website. Their
                    privacy practices are their own.
                </li>
                <li>
                    Searching for a place sends the text you type to a geocoding service so it can
                    be turned into coordinates.
                </li>
            </ul>
            <p>
                Surveillance-infrastructure layers are derived from OpenStreetMap and licensed
                under the{" "}
                <a
                    href="https://opendatacommons.org/licenses/odbl/1-0/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open Database Licence
                </a>
                . That data describes fixed equipment in public view, contributed by volunteers,
                and contains no information about individuals.
            </p>

            <h2>Why this processing is lawful (UK and EEA)</h2>
            <p>For visitors in the United Kingdom or European Economic Area, the operator relies on:</p>
            <ul>
                <li>
                    <strong>Contract</strong> &mdash; account data and the session cookie, which are
                    necessary to provide the service you asked for.
                </li>
                <li>
                    <strong>Legitimate interests</strong> &mdash; server logs, for security and
                    keeping the service running. The interest is operating the service safely; the
                    data is minimal and is never used to profile anyone.
                </li>
            </ul>
            <p>
                No processing relies on consent, because nothing optional is collected. There is no
                automated decision-making and no profiling.
            </p>

            <h2>How long data is kept</h2>
            <ul>
                <li>
                    <strong>Registered accounts</strong> &mdash; until you delete the account or ask
                    the operator to, after which the record and everything attached to it is
                    removed.
                </li>
                <li>
                    <strong>Guest records</strong> &mdash; removed automatically once the session
                    expires, which is seven days.
                </li>
                <li>
                    <strong>Cached layer data</strong> &mdash; transient, expiring automatically
                    within hours or days. It contains no personal data.
                </li>
                <li>
                    <strong>Server logs</strong> &mdash; per the hosting platform&apos;s defaults.
                </li>
            </ul>

            <h2>Your rights</h2>

            <h3>United Kingdom and European Economic Area</h3>
            <p>Under the UK GDPR and EU GDPR you have the right to:</p>
            <ul>
                <li>be told what personal data is held about you, and receive a copy;</li>
                <li>have inaccurate data corrected;</li>
                <li>have your data erased;</li>
                <li>restrict or object to processing;</li>
                <li>receive your data in a portable format;</li>
                <li>
                    complain to your supervisory authority &mdash; in the UK, the{" "}
                    <a
                        href="https://ico.org.uk/make-a-complaint/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Information Commissioner&apos;s Office
                    </a>
                    .
                </li>
            </ul>

            <h3>California</h3>
            <p>Under the CCPA, as amended by the CPRA, you have the right to:</p>
            <ul>
                <li>know what personal information is collected, and why;</li>
                <li>request access to it, or a copy;</li>
                <li>request its deletion or correction;</li>
                <li>not be discriminated against for exercising these rights.</li>
            </ul>
            <p>
                The operator does <strong>not</strong> sell personal information and does not share
                it for cross-context behavioural advertising, so there is nothing to opt out of. No
                sensitive personal information is collected.
            </p>

            <h3>Making a request</h3>
            <p>
                Email <strong>{contactEmail()}</strong>. The operator will reply within the period
                the applicable law requires, and may need to confirm that you control the account
                in question before acting. Requests are free.
            </p>

            <h2>Children</h2>
            <p>
                Accounts are for people aged {MIN_AGE} or over. If you are in the UK or EEA and
                under {EU_CONSENT_AGE}, you need a parent or guardian&apos;s authorisation. The
                service is not directed at children, and no data is knowingly collected from anyone
                under {MIN_AGE}. If you believe a child under {MIN_AGE} has created an account,
                contact <strong>{contactEmail()}</strong> and it will be deleted.
            </p>

            <h2>Security</h2>
            <p>
                Traffic is served over HTTPS. Passwords are stored only as one-way hashes. Access
                to the server and database is restricted to the operator. No system is perfectly
                secure, so please use a unique password, and tell the operator promptly if you
                think your account has been compromised.
            </p>

            <h2>Where data is held</h2>
            <p>
                Account data is held on the server the operator runs, in that server&apos;s
                location. Because some map and layer providers are contacted directly by your
                browser, those requests may reach infrastructure in other countries &mdash; the same
                as visiting any international website.
            </p>

            <h2>Changes</h2>
            <p>
                If this policy changes, the date at the top of this page changes with it. Material
                changes affecting registered accounts will be notified by email where the operator
                holds an address for you.
            </p>

            <p>
                See also the <Link href="/legal/terms-of-service">Terms of Service</Link>.
            </p>
        </>
    );
}
