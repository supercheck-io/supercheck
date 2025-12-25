import type { Metadata } from 'next';
import { SiteHeader } from '../../lib/layout.shared';

export const metadata: Metadata = {
    title: 'Terms of Service | Supercheck',
    description: 'Terms of Service for Supercheck - AI-powered test automation and monitoring platform.',
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader />

            <main className="container py-12 md:py-20 max-w-4xl">
                <h1 className="text-4xl font-bold tracking-tight mb-4">Terms of Service</h1>
                <p className="text-fd-muted-foreground mb-8">Last updated: December 2025</p>

                <div className="prose prose-neutral dark:prose-invert max-w-none">
                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">1. Agreement to Terms</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            By accessing or using Supercheck (&ldquo;Service&rdquo;), you agree to be bound by these Terms of Service.
                            If you do not agree to these terms, do not use the Service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            Supercheck is an open source test automation and monitoring platform that provides:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Browser test automation using Playwright</li>
                            <li>Performance testing using Grafana k6</li>
                            <li>Uptime and synthetic monitoring</li>
                            <li>AI-powered test creation and fix suggestions</li>
                            <li>Public status pages</li>
                            <li>Alert notifications via email, Slack, Discord, Telegram, and webhooks</li>
                        </ul>
                        <p className="text-fd-muted-foreground mb-4">
                            The Service is available as a cloud-hosted solution or as a self-hosted deployment
                            on your own infrastructure.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">3. Account Terms</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            To use certain features of the Service, you must register for an account. You agree to:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Provide accurate and complete registration information</li>
                            <li>Maintain the security of your account credentials</li>
                            <li>Accept responsibility for all activities under your account</li>
                            <li>Notify us immediately of any unauthorized account access</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">4. Acceptable Use</h2>
                        <p className="text-fd-muted-foreground mb-4">You agree not to:</p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
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
                        <p className="text-fd-muted-foreground mb-4">
                            You retain ownership of any test scripts, configurations, and content you create using the Service.
                            By using the Service, you grant us a limited license to store and process your content
                            solely to provide the Service to you.
                        </p>
                        <p className="text-fd-muted-foreground mb-4">
                            You are responsible for ensuring you have the necessary rights to test the websites,
                            APIs, and systems you configure in Supercheck.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">6. Cloud Subscription Plans</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            Cloud-hosted users may subscribe to paid plans with specific usage limits and features.
                            Subscription terms include:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Plans are billed monthly</li>
                            <li>Usage beyond included quotas is billed at overage rates</li>
                            <li>You may upgrade or downgrade plans at any time</li>
                            <li>Refunds are handled on a case-by-case basis</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">7. Self-Hosted Deployments</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            Supercheck is available as open source software for self-hosted deployments.
                            Self-hosted users are responsible for their own infrastructure, security, and data management.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">8. Third-Party Services</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            The Service integrates with third-party services including:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Authentication providers (GitHub, Google)</li>
                            <li>AI services for test generation and fix suggestions</li>
                            <li>Payment processing services</li>
                            <li>Notification services (email, Slack, Discord, Telegram)</li>
                        </ul>
                        <p className="text-fd-muted-foreground mb-4">
                            Your use of these integrations is subject to their respective terms of service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">9. Disclaimer of Warranties</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.
                            WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">10. Limitation of Liability</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE SHALL NOT BE LIABLE FOR ANY INDIRECT,
                            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE SERVICE.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">11. Changes to Terms</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            We may update these Terms from time to time. We will notify users of material changes
                            via email or through the Service. Continued use after changes constitutes acceptance
                            of the updated Terms.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">12. Contact</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            For questions about these Terms, please contact us at{' '}
                            <a href="mailto:hello@supercheck.io" className="text-fd-primary hover:underline">
                                hello@supercheck.io
                            </a>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
