import type { Metadata } from 'next';
import { OG_IMAGE } from '../../lib/assets';
import Link from 'next/link';
import { SiteHeader } from '../../lib/layout.shared';

export const metadata: Metadata = {
    title: { absolute: 'Security | Supercheck' },
    alternates: { canonical: '/security' },
    description: 'How Supercheck protects your data: encryption, access control, audit logging, sandboxed test runs and responsible disclosure.',
    openGraph: { title: 'Security | Supercheck', description: 'How Supercheck protects your data: encryption, access control, audit logging, sandboxed test runs and responsible disclosure.', url: '/security', siteName: 'Supercheck', type: 'website', images: [OG_IMAGE] },
};

export default function SecurityPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader />

            <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
                <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Security</h1>
                <p className="text-fd-muted-foreground mb-8">Last updated: <time dateTime="2026-11-17">November 17, 2026</time></p>

                <div className="leading-7">
                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">1. Overview</h2>
                        <p className="mb-4">
                            This page describes the security controls built into Supercheck and how we run
                            Supercheck Cloud. Supercheck Cloud is coming soon; signups are not open yet. Sections
                            marked &ldquo;Cloud&rdquo; describe how the hosted service is set up for launch. Self-hosted operators
                            run their own infrastructure and control those parts themselves.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">2. Encryption</h2>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>
                                <strong>Secrets:</strong> secret project variables, notification provider settings, AI SRE
                                connector credentials, and heartbeat monitor tokens are encrypted with AES-GCM authenticated
                                encryption before they are written to the database.
                            </li>
                            <li>
                                <strong>In transit:</strong> traffic to Supercheck Cloud is served over HTTPS/TLS.
                            </li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">3. Access control</h2>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li>
                                <strong>Roles:</strong> organization roles (owner, admin) and project roles (admin, editor,
                                viewer) limit what each member can see and change.
                            </li>
                            <li>
                                <strong>Sign-in:</strong> email and password, or OAuth sign-in with GitHub or Google.
                            </li>
                        </ul>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">4. Audit log</h2>
                        <p className="mb-4">
                            Supercheck records an audit log of security-relevant actions. By default, audit entries are
                            kept for 12 months, and after 30 days email addresses in them are replaced with a keyed hash.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">5. Isolated test runs (Cloud)</h2>
                        <p className="mb-4">
                            On Supercheck Cloud, test runs execute in short-lived pods sandboxed with gVisor, and a
                            network policy restricts their outbound traffic.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">6. Backups (Cloud)</h2>
                        <p className="mb-4">
                            Supercheck Cloud keeps backups in off-host storage, separate from the servers that run
                            the service.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">7. Infrastructure providers (Cloud)</h2>
                        <p className="mb-4">Supercheck Cloud relies on providers including:</p>
                        <ul className="mb-4 list-disc space-y-2 pl-6">
                            <li><strong>Hetzner:</strong> compute servers</li>
                            <li><strong>Cloudflare:</strong> DNS and object storage</li>
                            <li><strong>PlanetScale:</strong> managed PostgreSQL database</li>
                            <li><strong>GitHub and Google:</strong> OAuth sign-in, when you choose it</li>
                            <li><strong>AI model providers:</strong> AI-assisted features you use</li>
                            <li><strong>Payment processor:</strong> subscription billing</li>
                        </ul>
                        <p className="mb-4">
                            See the{' '}
                            <Link href="/privacy" className="text-fd-primary hover:underline">Privacy Policy</Link>{' '}
                            for the data shared with AI, authentication, payment, and notification providers.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">8. Self-hosting</h2>
                        <p className="mb-4">
                            If your data must stay in your own environment, you can{' '}
                            <Link href="/docs/app/deployment/self-hosted" className="text-fd-primary hover:underline">
                                self-host Supercheck
                            </Link>
                            . Self-hosted operators choose where their data lives and which integrations are enabled.
                        </p>
                    </section>

                    <section className="mb-10">
                        <h2 className="text-2xl font-semibold mb-4">9. Reporting a vulnerability</h2>
                        <p className="mb-4">
                            Please report vulnerabilities privately through{' '}
                            <a
                                href="https://github.com/supercheck-io/supercheck/security/advisories/new"
                                className="text-fd-primary hover:underline"
                            >
                                GitHub private vulnerability reporting
                            </a>{' '}
                            or by email to{' '}
                            <a href="mailto:hello@supercheck.io?subject=Security%20report" className="text-fd-primary hover:underline">
                                hello@supercheck.io
                            </a>{' '}
                            with the subject &ldquo;Security report&rdquo;. Do not open a public issue. Our full policy is in{' '}
                            <a
                                href="https://github.com/supercheck-io/supercheck/blob/main/SECURITY.md"
                                className="text-fd-primary hover:underline"
                            >
                                SECURITY.md
                            </a>
                            .
                        </p>
                    </section>
                </div>
                <nav aria-label="Legal and pricing" className="mt-12 flex flex-wrap gap-x-6 gap-y-3 border-t border-fd-border pt-6 text-sm text-fd-muted-foreground">
                    <Link href="/terms" className="hover:text-fd-foreground hover:underline">Terms of Service</Link>
                    <Link href="/privacy" className="hover:text-fd-foreground hover:underline">Privacy Policy</Link>
                    <Link href="/security" className="hover:text-fd-foreground hover:underline">Security</Link>
                    <Link href="/pricing" className="hover:text-fd-foreground hover:underline">Cloud pricing</Link>
                </nav>
            </main>
        </div>
    );
}
