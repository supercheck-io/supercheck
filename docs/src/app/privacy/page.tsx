import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '../../lib/layout.shared';

export const metadata: Metadata = {
    title: { absolute: 'Privacy Policy | Supercheck' },
    alternates: { canonical: '/privacy' },
    description: 'Privacy Policy for Supercheck - How we handle your data.',
};

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader />

            <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
                <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
                <p className="text-fd-muted-foreground mb-8">Last updated: <time dateTime="2026-10-27">October 27, 2026</time></p>

                <div className="leading-7">
                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
                        <p className="mb-4">
                            This Privacy Policy describes how Supercheck (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the Service&rdquo;)
                            collects, uses, and protects your information when you use our testing, monitoring,
                            and AI SRE platform.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>

                        <h3 className="mb-3 mt-6 text-xl font-medium">Account Information</h3>
                        <p className="mb-4">
                            When you create an account, we collect:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Email address</li>
                            <li>Name (if provided)</li>
                            <li>Profile information from OAuth providers (GitHub, Google) if used</li>
                        </ul>

                        <h3 className="mb-3 mt-6 text-xl font-medium">Usage Data</h3>
                        <p className="mb-4">
                            We collect usage data to provide and improve the Service:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Test execution logs and results</li>
                            <li>Monitoring check results</li>
                            <li>Test scripts and configurations you create</li>
                            <li>Screenshots, traces, and videos from test runs</li>
                            <li>Performance metrics from k6 load tests</li>
                            <li>Incident reports, investigation conversations, and evidence from connectors you configure</li>
                        </ul>

                        <h3 className="mb-3 mt-6 text-xl font-medium">Billing Information</h3>
                        <p className="mb-4">
                            For cloud-hosted paid plans, payment information is processed by our payment provider.
                            We do not store credit card details directly.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
                        <p className="mb-4">We use your information to:</p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Provide and operate the Service</li>
                            <li>Execute tests and monitoring checks you configure</li>
                            <li>Send alerts and notifications you have set up</li>
                            <li>Process AI-assisted test creation, fixes, failure analysis, and SRE investigations</li>
                            <li>Track usage for billing purposes (cloud plans)</li>
                            <li>Communicate important updates about the Service</li>
                            <li>Improve and secure the Service</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">4. Data Retention</h2>
                        <p className="mb-4">
                            Standard Cloud plan retention periods depend on the type of data. Cloud plans are
                            coming soon; these are the planned retention periods:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li><strong>Playground artifacts:</strong> 24 hours</li>
                            <li><strong>Monitor raw data:</strong> 7 days on Plus and Pro</li>
                            <li><strong>Aggregated metrics:</strong> 30 days on Plus; 90 days on Pro</li>
                            <li><strong>Job run history:</strong> 30 days on Plus; 90 days on Pro</li>
                        </ul>
                        <p className="mb-4">
                            Enterprise and self-hosted retention settings may differ. You may request deletion
                            of your account and associated data at any time.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">5. Data Sharing</h2>
                        <p className="mb-4">
                            We share data with third parties only as necessary to provide the Service:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li><strong>Authentication providers:</strong> GitHub, Google for OAuth sign-in</li>
                            <li><strong>AI services:</strong> Inputs you submit or authorize for test generation, analysis, and
                                investigations, such as test code, logs, error messages, and selected connector evidence.
                                Avoid including secrets in these inputs.</li>
                            <li><strong>Payment processor:</strong> For subscription billing</li>
                            <li><strong>Notification services:</strong> Email, Slack, Discord, Telegram, Microsoft Teams, and webhooks for alerts you configure</li>
                            <li><strong>Support tools:</strong> Account details and support conversations when support chat is enabled</li>
                            <li><strong>Error monitoring:</strong> Sentry receives technical error reports from the hosted cloud
                                service. A report contains the error type, a shortened error message that is
                                scrubbed to remove secrets, URLs, email addresses, quoted text, and database values,
                                a stack trace, the service, release, and environment, and internal IDs. We do not
                                attach request contents, headers, cookies, form inputs, test scripts, or run logs.
                                Scrubbing is automated and best effort.</li>
                        </ul>
                        <p className="mb-4">
                            We do not sell your personal information to third parties.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">6. Self-Hosted Deployments</h2>
                        <p className="mb-4">
                            Self-hosted operators control their deployment and storage. Enabled integrations send
                            selected data to the AI, authentication, notification, or support providers they configure.
                            We do not have access to self-hosted application data unless it is shared with us for support.
                            Self-hosted deployments send nothing to Sentry.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">7. Security</h2>
                        <p className="mb-4">
                            We implement security measures to protect your data:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Encryption in transit (HTTPS/TLS)</li>
                            <li>Encrypted storage for sensitive data like API keys and credentials</li>
                            <li>Role-based access control within organizations</li>
                            <li>Regular security reviews</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">8. Your Rights</h2>
                        <p className="mb-4">You have the right to:</p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Access your personal data</li>
                            <li>Correct inaccurate data</li>
                            <li>Request deletion of your data</li>
                            <li>Export your data</li>
                            <li>Withdraw consent where applicable</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">9. Cookies</h2>
                        <p className="mb-4">
                            We use essential cookies for session management and authentication.
                            We do not use third-party tracking cookies.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">10. Open Source</h2>
                        <p className="mb-4">
                            Supercheck core is open source under AGPL-3.0-only. You can review how data is handled by
                            examining our{' '}
                            <a href="https://github.com/supercheck-io/supercheck" className="text-fd-primary hover:underline">
                                source code on GitHub
                            </a>.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">11. Changes to This Policy</h2>
                        <p className="mb-4">
                            We may update this Privacy Policy from time to time. We will notify users of
                            significant changes via email or through the Service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">12. Contact</h2>
                        <p className="mb-4">
                            For privacy-related questions, please contact us at{' '}
                            <a href="mailto:hello@supercheck.io" className="text-fd-primary hover:underline">
                                hello@supercheck.io
                            </a>.
                        </p>
                    </section>
                </div>
                <nav aria-label="Legal and pricing" className="mt-12 flex flex-wrap gap-x-6 gap-y-3 border-t border-fd-border pt-6 text-sm text-fd-muted-foreground">
                    <Link href="/terms" className="hover:text-fd-foreground hover:underline">Terms of Service</Link>
                    <Link href="/privacy" className="hover:text-fd-foreground hover:underline">Privacy Policy</Link>
                    <Link href="/pricing" className="hover:text-fd-foreground hover:underline">Cloud pricing</Link>
                </nav>
            </main>
        </div>
    );
}
