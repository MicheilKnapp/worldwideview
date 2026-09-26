import type { Metadata } from "next";
import Link from "next/link";

import { LegalNotice } from "../LegalNotice";
import {
    EU_CONSENT_AGE,
    MIN_AGE,
    SITE_NAME,
    contactEmail,
    formattedDate,
    jurisdiction,
    operatorName,
} from "../legalConfig";

export const metadata: Metadata = {
    title: "Terms of Service",
    description: "Terms governing use of this WorldWideView instance.",
};

export default function TermsOfServicePage() {
    return (
        <>
            <Link href="/login" className="legal-back">
                &larr; Back
            </Link>
            <h1>Terms of Service</h1>
            <p className="legal-updated">Last updated {formattedDate()}</p>

            <LegalNotice />

            <h2>1. Agreement</h2>
            <p>
                These terms govern your use of {SITE_NAME}, an independently operated installation
                of WorldWideView run by <strong>{operatorName()}</strong> (&quot;the
                operator&quot;). By creating an account, continuing as a guest, or otherwise using
                the service, you accept these terms. If you do not accept them, do not use the
                service.
            </p>
            <p>
                The operator provides this service. The WorldWideView project publishes the
                software but does not operate this instance and is not a party to these terms.
            </p>

            <h2>2. Eligibility</h2>
            <p>
                You must be at least {MIN_AGE} years old to use the service. If you are in the
                United Kingdom or European Economic Area and under {EU_CONSENT_AGE}, you must have
                a parent or guardian&apos;s authorisation. If you are using the service on behalf of
                an organisation, you confirm you are authorised to bind it to these terms.
            </p>

            <h2>3. Accounts and guest access</h2>
            <ul>
                <li>
                    You may use the service without registering, by choosing{" "}
                    <strong>Continue as Guest</strong>. Guest sessions are temporary and are
                    deleted after they expire, along with anything saved in them.
                </li>
                <li>
                    If you register, you are responsible for everything done under your account and
                    for keeping your password secure. Use a unique password.
                </li>
                <li>Provide accurate registration details and keep your email address current.</li>
                <li>Do not share your credentials or let anyone else use your account.</li>
                <li>
                    Tell the operator promptly at <strong>{contactEmail()}</strong> if you believe
                    your account has been compromised.
                </li>
                <li>You may delete your account at any time. See section 9.</li>
            </ul>

            <h2>4. Acceptable use</h2>
            <p>You must not:</p>
            <ul>
                <li>break the law, or infringe anyone&apos;s rights, in your use of the service;</li>
                <li>
                    use information from the service to harass, stalk, intimidate, threaten or
                    endanger any person, or to interfere with anyone&apos;s lawful activities;
                </li>
                <li>
                    attempt to gain unauthorised access to the service, to other accounts, or to the
                    infrastructure behind it, or probe or test its security without the
                    operator&apos;s written permission;
                </li>
                <li>
                    disrupt or overload the service, including by automated scraping, bulk
                    downloading, or request volumes that degrade it for others;
                </li>
                <li>
                    abuse the upstream data providers the service depends on, or use the service to
                    get around their terms, licences or rate limits;
                </li>
                <li>
                    resell or redistribute access to the service, or present it as your own, without
                    the operator&apos;s permission;
                </li>
                <li>
                    upload or transmit malware, or anything designed to interfere with the service
                    or its users;
                </li>
                <li>
                    misrepresent your identity or affiliation, or create accounts by automated
                    means.
                </li>
            </ul>
            <p>
                The operator may suspend or remove any account, with or without notice, that
                breaches these terms or that is used in a way that threatens the service, its
                upstream providers, or other users.
            </p>

            <h2>5. Data shown on the map</h2>
            <p>
                The service visualises data from third-party public sources. It is provided for
                information and transparency only.
            </p>
            <ul>
                <li>
                    <strong>It is not verified.</strong> Much of it is contributed by volunteers or
                    published automatically. It may be incomplete, out of date, misclassified or
                    simply wrong.
                </li>
                <li>
                    <strong>Do not rely on it where being wrong matters.</strong> Nothing here is
                    suitable for navigation, emergency response, legal proceedings, compliance,
                    investment, or any decision with real consequences.
                </li>
                <li>
                    <strong>Some classifications are inferred, not confirmed.</strong> Where a layer
                    marks something as unverified &mdash; for example public-space cameras whose
                    operator is unknown &mdash; treat it as an indication and nothing more. Do not
                    present it as established fact.
                </li>
                <li>
                    <strong>Upstream licences apply to you.</strong> Data carries its own terms.
                    OpenStreetMap-derived layers are licensed under the{" "}
                    <a
                        href="https://opendatacommons.org/licenses/odbl/1-0/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Open Database Licence
                    </a>
                    , which requires attribution to OpenStreetMap contributors if you reuse the
                    data, and share-alike terms if you redistribute a derived database.
                </li>
                <li>
                    Layers may be added, changed or removed at any time, including because an
                    upstream source becomes unavailable or changes its terms.
                </li>
            </ul>

            <h2>6. Availability</h2>
            <p>
                The service is provided on an as-available basis, with no uptime commitment,
                support obligation or guarantee of data freshness. The operator may change, suspend
                or discontinue the service, or any part of it, at any time. Where practical, notice
                will be given for planned changes that remove functionality.
            </p>

            <h2>7. Intellectual property and software licence</h2>
            <p>
                WorldWideView is licensed under the{" "}
                <a
                    href="https://www.elastic.co/licensing/elastic-license"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Elastic License 2.0
                </a>
                . These terms govern your use of this instance, not your rights in the software
                itself, which that licence sets out. Third-party data and imagery remain the
                property of their respective owners under their own licences.
            </p>

            <h2>8. Privacy</h2>
            <p>
                The <Link href="/legal/privacy-policy">Privacy Policy</Link> explains what the
                service collects and what it does not. In short: only what an account needs, with
                no analytics, telemetry, advertising or tracking.
            </p>

            <h2>9. Ending your use</h2>
            <p>
                You may stop using the service at any time, and may ask the operator to delete your
                account and its data by emailing <strong>{contactEmail()}</strong>. The operator may
                terminate or suspend your access for breach of these terms, or if required by law.
                On termination, the parts of these terms that by their nature should survive
                &mdash; sections 5, 10 and 11 in particular &mdash; continue to apply.
            </p>

            <h2>10. Disclaimer and limitation of liability</h2>
            <p>
                The service is provided &quot;as is&quot; and &quot;as available&quot;, without
                warranties of any kind, whether express or implied, including any implied warranty
                of merchantability, fitness for a particular purpose, accuracy, completeness,
                title, or non-infringement. The operator does not warrant that the service will be
                uninterrupted, error-free, secure, or that the data shown is accurate or current.
            </p>
            <p>
                To the fullest extent permitted by law, the operator is not liable for any
                indirect, incidental, special, consequential, exemplary or punitive loss, nor for
                any loss of data, profit, revenue, business or goodwill, arising out of or in
                connection with your use of the service or reliance on anything shown in it. This
                applies however the loss arises, including in contract, tort or negligence, and
                even if the operator was told such loss was possible.
            </p>
            <p>
                Where liability cannot lawfully be excluded, it is limited to the greater of the
                amount you paid the operator for the service in the twelve months before the claim,
                or ten units of the local currency. The service is provided free of charge, so in
                most cases that amount will be nil.
            </p>
            <p>
                Nothing in these terms excludes or limits liability for death or personal injury
                caused by negligence, for fraud or fraudulent misrepresentation, or for anything
                else that cannot lawfully be excluded or limited. Some jurisdictions do not allow
                certain exclusions, so parts of this section may not apply to you.
            </p>

            <h2>11. Indemnity</h2>
            <p>
                You agree to indemnify the operator against claims, losses and reasonable costs
                arising from your breach of these terms, your misuse of the service, or your use of
                data obtained through it in a way that breaches an upstream licence or harms
                another person.
            </p>

            <h2>12. Governing law</h2>
            <p>
                These terms are governed by the laws of <strong>{jurisdiction()}</strong>, without
                regard to its conflict-of-laws rules, and the courts of that jurisdiction have
                exclusive jurisdiction over any dispute. If you are a consumer, this does not remove
                any right you have to bring proceedings in your own country of residence, or to rely
                on mandatory consumer protections there.
            </p>

            <h2>13. Changes to these terms</h2>
            <p>
                These terms may change; the date at the top of this page changes with them. For
                material changes, the operator will give notice by email where it holds an address
                for you, or by a notice in the service. Continuing to use the service after a
                change takes effect means you accept the revised terms. If you do not accept them,
                stop using the service and ask for your account to be deleted.
            </p>

            <h2>14. General</h2>
            <p>
                If any provision of these terms is found unenforceable, the rest continues to
                apply. A delay in enforcing a term is not a waiver of it. You may not transfer your
                rights under these terms without the operator&apos;s consent. These terms are the
                entire agreement between you and the operator about the service.
            </p>

            <h2>15. Contact</h2>
            <p>
                Questions about these terms: <strong>{contactEmail()}</strong>.
            </p>

            <p>
                See also the <Link href="/legal/privacy-policy">Privacy Policy</Link>.
            </p>
        </>
    );
}
