import type { Metadata } from "next";
import Link from "next/link";

import { LegalNotice } from "../LegalNotice";
import { SITE_NAME, contactEmail, formattedDate, jurisdiction, operatorName } from "../legalConfig";

export const metadata: Metadata = {
    title: "Terms of Service",
    description: "Terms governing use of this WorldWideView instance.",
};

export default function TermsOfServicePage() {
    return (
        <>
            <Link href="/login" className="legal-back">
                ← Back
            </Link>
            <h1>Terms of Service</h1>
            <p className="legal-updated">Last updated {formattedDate()}</p>

            <LegalNotice />

            <h2>Agreement</h2>
            <p>
                These terms govern your use of {SITE_NAME}, an independently operated installation
                of WorldWideView run by <strong>{operatorName()}</strong> (&quot;the
                operator&quot;). By using this instance you accept them. If you do not, please do
                not use it.
            </p>
            <p>
                The operator provides this service; the WorldWideView project publishes the
                software but does not operate this instance and is not a party to these terms.
            </p>

            <h2>Accounts</h2>
            <ul>
                <li>You are responsible for activity under your account and for your password.</li>
                <li>Provide accurate registration details and keep your email address current.</li>
                <li>Do not share credentials or let others use your account.</li>
                <li>
                    The operator may suspend or remove an account that breaches these terms, or
                    that is used in a way that threatens the service or other users.
                </li>
            </ul>

            <h2>Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
                <li>
                    Break the law, or infringe anyone&apos;s rights, in your use of the service.
                </li>
                <li>
                    Attempt to gain unauthorised access to the service, other accounts, or the
                    infrastructure behind it.
                </li>
                <li>
                    Disrupt or overload the service, including by automated scraping or request
                    volumes that degrade it for others.
                </li>
                <li>
                    Abuse the upstream data providers the service depends on, or use the service
                    to circumvent their terms or rate limits.
                </li>
                <li>
                    Use information from the service to harass, stalk, intimidate or endanger any
                    person.
                </li>
            </ul>

            <h2>Data shown on the map</h2>
            <p>
                The service visualises data from third-party public sources. It is provided for
                information and transparency only.
            </p>
            <ul>
                <li>
                    <strong>It is not verified.</strong> Much of it is contributed by volunteers or
                    published automatically. It may be incomplete, out of date or wrong.
                </li>
                <li>
                    <strong>Do not rely on it for safety or navigation.</strong> Nothing here is
                    suitable for navigation, emergency response, or any decision where being wrong
                    carries a real cost.
                </li>
                <li>
                    <strong>Some layers describe inferred categories.</strong> Where a layer says a
                    classification is unverified — for example public-space cameras whose operator
                    is unknown — treat it as an indication and nothing more.
                </li>
                <li>
                    <strong>Upstream licences apply.</strong> Data carries its own terms.
                    OpenStreetMap-derived layers are licensed under the{" "}
                    <a
                        href="https://opendatacommons.org/licenses/odbl/1-0/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Open Database Licence
                    </a>{" "}
                    and require attribution to OpenStreetMap contributors if you reuse them.
                </li>
            </ul>

            <h2>Availability</h2>
            <p>
                The service is provided on an as-available basis. There is no uptime commitment.
                The operator may change, suspend or discontinue it, or any layer within it, at any
                time — including because an upstream data source becomes unavailable or changes
                its terms.
            </p>

            <h2>Software licence</h2>
            <p>
                WorldWideView is licensed under the{" "}
                <a
                    href="https://www.elastic.co/licensing/elastic-license"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Elastic License 2.0
                </a>
                . These terms cover your use of this instance, not your rights in the software
                itself, which that licence governs.
            </p>

            <h2>Disclaimer and liability</h2>
            <p>
                The service is provided &quot;as is&quot;, without warranties of any kind, whether
                express or implied, including fitness for a particular purpose, accuracy, or
                non-infringement.
            </p>
            <p>
                To the fullest extent the law allows, the operator is not liable for any indirect,
                incidental, special or consequential loss, or for any loss of data, profit or
                goodwill, arising from your use of the service. Nothing here excludes liability
                that cannot lawfully be excluded.
            </p>

            <h2>Governing law</h2>
            <p>
                These terms are governed by the laws of <strong>{jurisdiction()}</strong>, without
                regard to conflict-of-laws rules.
            </p>

            <h2>Changes</h2>
            <p>
                These terms may change; the date at the top of this page will change with them.
                Continuing to use the service after a change means you accept the revised terms.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about these terms: <strong>{contactEmail()}</strong>.
            </p>

            <p>
                See also the <Link href="/legal/privacy-policy">Privacy Policy</Link>.
            </p>
        </>
    );
}
