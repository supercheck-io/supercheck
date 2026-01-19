import type { Metadata } from 'next';
import { SiteHeader } from '../../lib/layout.shared';

export const metadata: Metadata = {
    title: 'Privacy Policy | Supercheck',
    description: 'Privacy Policy for Supercheck - How we handle your data.',
};

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader showPricing={false} />

            <main className="container py-12 md:py-20 max-w-4xl">
                <h1 className="text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
                <p className="text-fd-muted-foreground mb-8">Last updated: December 2025</p>

                <div className="prose prose-neutral dark:prose-invert max-w-none">
                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            This Privacy Policy describes how Supercheck (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the Service&rdquo;)
                            collects, uses, and protects your information when you use our test automation
                            and monitoring platform.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>

                        <h3 className="text-xl font-medium mb-3">Account Information</h3>
                        <p className="text-fd-muted-foreground mb-4">
                            When you create an account, we collect:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Email address</li>
                            <li>Name (if provided)</li>
                            <li>Profile information from OAuth providers (GitHub, Google) if used</li>
                        </ul>

                        <h3 className="text-xl font-medium mb-3">Usage Data</h3>
                        <p className="text-fd-muted-foreground mb-4">
                            We collect usage data to provide and improve the Service:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Test execution logs and results</li>
                            <li>Monitoring check results</li>
                            <li>Test scripts and configurations you create</li>
                            <li>Screenshots, traces, and videos from test runs</li>
                            <li>Performance metrics from k6 load tests</li>
                        </ul>

                        <h3 className="text-xl font-medium mb-3">Billing Information</h3>
                        <p className="text-fd-muted-foreground mb-4">
                            For cloud-hosted paid plans, payment information is processed by our payment provider.
                            We do not store credit card details directly.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
                        <p className="text-fd-muted-foreground mb-4">We use your information to:</p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Provide and operate the Service</li>
                            <li>Execute tests and monitoring checks you configure</li>
                            <li>Send alerts and notifications you have set up</li>
                            <li>Process AI-powered test creation and fix suggestions</li>
                            <li>Track usage for billing purposes (cloud plans)</li>
                            <li>Communicate important updates about the Service</li>
                            <li>Improve and secure the Service</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">4. Data Retention</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            Data retention periods depend on your plan and the type of data:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li><strong>Playground artifacts:</strong> 24 hours</li>
                            <li><strong>Monitor raw data:</strong> 7-30 days depending on plan</li>
                            <li><strong>Aggregated metrics:</strong> 30-365 days depending on plan</li>
                            <li><strong>Job run history:</strong> 30-90 days depending on plan</li>
                        </ul>
                        <p className="text-fd-muted-foreground mb-4">
                            You may request deletion of your account and associated data at any time.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">5. Data Sharing</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            We share data with third parties only as necessary to provide the Service:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li><strong>Authentication providers:</strong> GitHub, Google for OAuth sign-in</li>
                            <li><strong>AI services:</strong> For test generation and fix suggestions (test code only, not credentials)</li>
                            <li><strong>Payment processor:</strong> For subscription billing</li>
                            <li><strong>Notification services:</strong> Email, Slack, Discord, Telegram for alerts you configure</li>
                        </ul>
                        <p className="text-fd-muted-foreground mb-4">
                            We do not sell your personal information to third parties.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">6. Self-Hosted Deployments</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            If you self-host Supercheck on your own infrastructure, your data remains entirely
                            under your control. We do not have access to data in self-hosted installations
                            unless you explicitly share it for support purposes.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">7. Security</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            We implement security measures to protect your data:
                        </p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Encryption in transit (HTTPS/TLS)</li>
                            <li>Encrypted storage for sensitive data like API keys and credentials</li>
                            <li>Role-based access control within organizations</li>
                            <li>Regular security reviews</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">8. Your Rights</h2>
                        <p className="text-fd-muted-foreground mb-4">You have the right to:</p>
                        <ul className="list-disc pl-6 text-fd-muted-foreground space-y-2 mb-4">
                            <li>Access your personal data</li>
                            <li>Correct inaccurate data</li>
                            <li>Request deletion of your data</li>
                            <li>Export your data</li>
                            <li>Withdraw consent where applicable</li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">9. Cookies</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            We use essential cookies for session management and authentication.
                            We do not use third-party tracking cookies.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">10. Open Source</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            Supercheck is open source software. You can review how data is handled by
                            examining our{' '}
                            <a href="https://github.com/supercheck-io/supercheck" className="text-fd-primary hover:underline">
                                source code on GitHub
                            </a>.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">11. Changes to This Policy</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            We may update this Privacy Policy from time to time. We will notify users of
                            significant changes via email or through the Service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">12. Contact</h2>
                        <p className="text-fd-muted-foreground mb-4">
                            For privacy-related questions, please contact us at{' '}
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
