import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '../../lib/layout.shared';

export const metadata: Metadata = {
    title: { absolute: 'Terms of Service | Supercheck' },
    alternates: { canonical: '/terms' },
    description: 'Terms of Service for Supercheck - Open-source testing, monitoring, and AI SRE — as code.',
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader showPricing={false} />

            <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
                <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
                <p className="text-fd-muted-foreground mb-8">Last updated: <time dateTime="2026-10-16">October 16, 2026</time></p>

                <div className="leading-7">
                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">1. Agreement to Terms</h2>
                        <p className="mb-4">
                            By accessing or using Supercheck (&ldquo;Service&rdquo;), you agree to be bound by these Terms of Service.
                            If you do not agree to these terms, do not use the Service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
                        <p className="mb-4">
                            Supercheck is an open-source testing, monitoring, and AI SRE platform that provides:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Browser test automation using Playwright</li>
                            <li>Performance testing using Grafana k6</li>
                            <li>Uptime and synthetic monitoring</li>
                            <li>AI-powered test creation and fix suggestions</li>
                            <li>AI-assisted SRE root cause analysis and incident investigation</li>
                            <li>Public status pages</li>
                            <li>Alert notifications via email, Slack, Discord, Telegram, and webhooks</li>
                        </ul>
                        <p className="mb-4">
                            Supercheck is available to self-host on your own infrastructure. Supercheck Cloud is
                            coming soon; Cloud signups and paid subscriptions are not open yet.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">3. Account Terms</h2>
                        <p className="mb-4">
                            To use certain features of the Service, you must register for an account. You agree to:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Provide accurate and complete registration information</li>
                            <li>Maintain the security of your account credentials</li>
                            <li>Accept responsibility for all activities under your account</li>
                            <li>Notify us immediately of any unauthorized account access</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">4. Acceptable Use</h2>
                        <p className="mb-4">You agree not to:</p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Use the Service for any unlawful purpose</li>
                            <li>Attempt to gain unauthorized access to any systems or networks</li>
                            <li>Interfere with or disrupt the Service or servers</li>
                            <li>Use the Service to test systems you do not own or have permission to test</li>
                            <li>Transmit malicious code or content</li>
                            <li>Violate any applicable laws or regulations</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">5. Your Content</h2>
                        <p className="mb-4">
                            You retain ownership of any test scripts, configurations, and content you create using the Service.
                            By using the Service, you grant us a limited license to store and process your content
                            solely to provide the Service to you.
                        </p>
                        <p className="mb-4">
                            You are responsible for ensuring you have the necessary rights to test the websites,
                            APIs, and systems you configure in Supercheck.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">6. Cloud Subscription Plans</h2>
                        <p className="mb-4">
                            When Supercheck Cloud launches, paid plans will include specific usage limits and features
                            shown on the <Link href="/pricing" className="text-fd-primary hover:underline">pricing page</Link>.
                            Subscription terms include:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Plans are billed monthly</li>
                            <li>Playwright, K6, and completed full AI SRE investigation usage beyond included allowances is billed at overage rates</li>
                            <li>AI credits have a hard monthly limit and do not incur overage charges</li>
                            <li>Review the effective date and any prorated charge in the billing portal before confirming a plan change</li>
                            <li>Refunds are handled on a case-by-case basis</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">7. Self-Hosted Deployments</h2>
                        <p className="mb-4">
                            Use, modification, and distribution of the self-hosted Supercheck core are governed by the{' '}
                            <a href="https://github.com/supercheck-io/supercheck/blob/main/LICENSE" className="text-fd-primary hover:underline">
                                GNU Affero General Public License v3.0 only (AGPL-3.0-only)
                            </a>, not these hosted-service Terms. Self-hosted users are responsible for their own
                            infrastructure, security, and data management.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">8. Third-Party Services</h2>
                        <p className="mb-4">
                            The Service integrates with third-party services including:
                        </p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>Authentication providers (GitHub, Google)</li>
                            <li>AI services for test generation and fix suggestions</li>
                            <li>Payment processing services</li>
                            <li>Notification services (email, Slack, Discord, Telegram)</li>
                        </ul>
                        <p className="mb-4">
                            Your use of these integrations is subject to their respective terms of service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">9. Disclaimer of Warranties</h2>
                        <p className="mb-4">
                            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
                            WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">10. Limitation of Liability</h2>
                        <p className="mb-4">
                            TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT,
                            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">11. Changes to Terms</h2>
                        <p className="mb-4">
                            We may update these Terms from time to time. We will notify users of material changes
                            via email or through the Service. Continued use after changes constitutes acceptance
                            of the updated Terms.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">12. Contact</h2>
                        <p className="mb-4">
                            For questions about these Terms, please contact us at{' '}
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
