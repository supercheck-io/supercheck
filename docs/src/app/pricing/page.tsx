import catalog from "../../../../app/src/lib/billing/plan-catalog.json";
import { trialFaqs, trialHighlights } from '../../../../app/src/lib/billing/trial-copy';
import React from 'react';
import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';
import { SiteHeader } from '../../lib/layout.shared';
import { SiteFooter } from '../../components/site-footer';
import { VendorComparison } from '../../components/pricing/vendor-comparison';
import { CopyEmail } from '../../components/pricing/copy-email';

type Feature = string | { text: string; hint: string };

const WAITLIST_EMAIL = 'hello@supercheck.io';
const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL || 'https://demo.supercheck.dev';

function mailtoHref(subject: string, body?: string) {
    const params = [`subject=${encodeURIComponent(subject)}`];
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    return `mailto:${WAITLIST_EMAIL}?${params.join('&')}`;
}

function waitlistHref(plan: string) {
    return mailtoHref(
        `Supercheck Cloud waitlist (${plan})`,
        `Please add me to the Supercheck Cloud waitlist for the ${plan} plan.`,
    );
}

const enterpriseHref = mailtoHref(
    'Supercheck Cloud Enterprise enquiry',
    'Hi, I would like to discuss Supercheck Cloud Enterprise. My team size, expected usage and locations are:\n',
);

const fmt = (value: number | string) => Number(value).toLocaleString("en-US");

function planFeatures(id: 'plus' | 'pro', support: string): Feature[] {
    const limits = catalog[id].limits;
    return [
        `${fmt(limits.maxMonitors)} monitors`,
        {
            text: `${fmt(limits.playwrightMinutesIncluded)} Playwright minutes/month`,
            hint: `About ${fmt(limits.playwrightMinutesIncluded * 12)} five-second Playwright runs`,
        },
        `${fmt(limits.k6VuMinutesIncluded)} k6 VU-minutes/month`,
        `${fmt(limits.aiCreditsIncluded)} AI credits/month`,
        `${fmt(limits.sreInvestigationUnitsIncluded)} AI SRE investigations/month`,
        `${fmt(limits.runningCapacity)} concurrent runs`,
        `${fmt(limits.maxTeamMembers)} team members, ${fmt(limits.maxProjects)} projects`,
        `${fmt(limits.maxStatusPages)} status pages with custom domains`,
        support,
    ];
}

const plans: {
    name: string;
    price?: string;
    period?: string;
    description: string;
    features: Feature[];
    cta: string;
    ctaLink: string;
    highlighted: boolean;
}[] = [
    {
        name: catalog.plus.name,
        price: `$${catalog.plus.monthlyPriceCents / 100}`,
        period: '/month',
        description: catalog.plus.description,
        features: planFeatures('plus', 'Email support'),
        cta: 'Join the Plus waitlist',
        ctaLink: waitlistHref('Plus'),
        highlighted: false,
    },
    {
        name: catalog.pro.name,
        price: `$${catalog.pro.monthlyPriceCents / 100}`,
        period: '/month',
        description: catalog.pro.description,
        features: planFeatures('pro', 'Priority email support'),
        cta: 'Join the Pro waitlist',
        ctaLink: waitlistHref('Pro'),
        highlighted: true,
    },
    {
        name: 'Enterprise',
        description: 'For organizations with custom volume, locations or compliance needs',
        features: [
            'Custom allowances for monitors, minutes and investigations',
            'Custom monitoring and execution locations',
            'Bring your own AI provider',
            'Custom data retention',
            'SLA with a dedicated account manager',
            'Onboarding and training',
        ],
        cta: 'Contact sales',
        ctaLink: enterpriseHref,
        highlighted: false,
    },
];

const overagePricing = [
    { metric: 'Playwright minute', plus: `$${(catalog.plus.overageCents.playwrightMinutes / 100).toFixed(2)}`, pro: `$${(catalog.pro.overageCents.playwrightMinutes / 100).toFixed(3)}` },
    { metric: 'k6 VU-minute', plus: `$${(catalog.plus.overageCents.k6VuMinutes / 100).toFixed(3)} ($${(catalog.plus.overageCents.k6VuMinutes * 10).toLocaleString("en-US")} per 1,000)`, pro: `$${(catalog.pro.overageCents.k6VuMinutes / 100).toFixed(3)} ($${(catalog.pro.overageCents.k6VuMinutes * 10).toLocaleString("en-US")} per 1,000)` },
    { metric: 'AI SRE investigation (completed)', plus: `$${(catalog.plus.overageCents.sreInvestigationUnits / 100).toFixed(2)}`, pro: `$${(catalog.pro.overageCents.sreInvestigationUnits / 100).toFixed(2)}` },
    { metric: 'AI credits', plus: 'No overage', pro: 'No overage' },
];

const CHECK = '✓';
const NONE = '—';
const CUSTOM = 'Custom';

interface ComparisonItem {
    name: string;
    hint?: string;
    plus: string;
    pro: string;
    enterprise: string;
}

const comparisonFeatures: { category: string; items: ComparisonItem[] }[] = [
    {
        category: 'Usage limits', items: [
            { name: 'Monitors', plus: `${Number(catalog.plus.limits.maxMonitors).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.maxMonitors).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Playwright minutes/month', hint: 'Shared by Playwright tests and synthetic monitors', plus: `${Number(catalog.plus.limits.playwrightMinutesIncluded).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.playwrightMinutesIncluded).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'k6 VU minutes/month', plus: `${Number(catalog.plus.limits.k6VuMinutesIncluded).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.k6VuMinutesIncluded).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'AI credits/month', plus: `${Number(catalog.plus.limits.aiCreditsIncluded).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.aiCreditsIncluded).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'AI SRE investigations/month', hint: 'Only completed investigation reports count', plus: `${Number(catalog.plus.limits.sreInvestigationUnitsIncluded).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.sreInvestigationUnitsIncluded).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Read-only evidence connectors', hint: 'AI SRE reads logs, metrics, traces and deploys from GitHub, Kubernetes, Prometheus, Grafana, Sentry, Datadog and more', plus: 'Included', pro: 'Included', enterprise: CUSTOM },
            { name: 'Private Agent support', hint: 'Run connectors inside your own network without opening inbound access', plus: 'Included', pro: 'Included', enterprise: CUSTOM },
            { name: 'Concurrent runs', hint: 'Tests and jobs that run at once. Extra runs wait in the queue, up to the queued-runs limit.', plus: `${Number(catalog.plus.limits.runningCapacity).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.runningCapacity).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Queued runs', plus: `${Number(catalog.plus.limits.queuedCapacity).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.queuedCapacity).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Minimum check interval', plus: '1 minute', pro: '1 minute', enterprise: CUSTOM },
            { name: 'Minimum synthetic check interval', plus: '5 minutes', pro: '5 minutes', enterprise: CUSTOM },
            { name: 'HTTP, SSL, ping and port monitoring locations', plus: 'Europe, North America, Asia Pacific', pro: 'Europe, North America, Asia Pacific', enterprise: CUSTOM },
            { name: 'Browser checks, Playwright tests and k6 execution', plus: 'Europe', pro: 'Europe', enterprise: CUSTOM },
        ]
    },
    {
        category: 'AI SRE', items: [
            { name: 'Standalone AI SRE Copilot', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Incident-scoped Copilot', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Evidence graph and reports', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Report snapshots and feedback', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Bring-your-own AI provider', plus: NONE, pro: NONE, enterprise: 'On request' },
        ]
    },
    {
        category: 'Team and projects', items: [
            { name: 'Team members', plus: `${Number(catalog.plus.limits.maxTeamMembers).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.maxTeamMembers).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Projects', plus: `${Number(catalog.plus.limits.maxProjects).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.maxProjects).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Status pages', plus: `${Number(catalog.plus.limits.maxStatusPages).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.maxStatusPages).toLocaleString("en-US")}`, enterprise: CUSTOM },
            { name: 'Subscribers per status page', plus: `${Number(catalog.plus.limits.maxStatusPageSubscribers).toLocaleString("en-US")}`, pro: `${Number(catalog.pro.limits.maxStatusPageSubscribers).toLocaleString("en-US")}`, enterprise: CUSTOM },
        ]
    },
    {
        category: 'Data retention', items: [
            { name: 'Raw monitor data', plus: `${Number(catalog.plus.limits.dataRetentionDays).toLocaleString("en-US")} days`, pro: `${Number(catalog.pro.limits.dataRetentionDays).toLocaleString("en-US")} days`, enterprise: CUSTOM },
            { name: 'Aggregated metrics', plus: `${Number(catalog.plus.limits.aggregatedDataRetentionDays).toLocaleString("en-US")} days`, pro: `${Number(catalog.pro.limits.aggregatedDataRetentionDays).toLocaleString("en-US")} days`, enterprise: CUSTOM },
            { name: 'Job run history', plus: `${Number(catalog.plus.limits.jobDataRetentionDays).toLocaleString("en-US")} days`, pro: `${Number(catalog.pro.limits.jobDataRetentionDays).toLocaleString("en-US")} days`, enterprise: CUSTOM },
        ]
    },
    {
        category: 'Features and support', items: [
            { name: 'Custom domains', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'CI/CD integration', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Cron job scheduling', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Requirements and coverage tracking', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Supercheck Recorder (Chrome and Edge)', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Variables, secrets and file data', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Role-based access and audit log', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Support', plus: 'Email', pro: 'Priority email', enterprise: 'Custom SLA' },
            { name: 'Dedicated account manager', plus: NONE, pro: NONE, enterprise: CHECK },
            { name: 'Onboarding and training', plus: NONE, pro: NONE, enterprise: CHECK },
        ]
    },
];

function ComparisonCell({ value }: { value: string }) {
    if (value === CHECK) {
        return (
            <>
                <Check aria-hidden="true" className="mx-auto size-4 text-fd-primary" />
                <span className="sr-only">Included</span>
            </>
        );
    }
    if (value === NONE) {
        return (
            <>
                <span aria-hidden="true" className="text-fd-muted-foreground">{NONE}</span>
                <span className="sr-only">Not included</span>
            </>
        );
    }
    return <>{value}</>;
}

const trial = catalog.trial;

const faqs = [
    {
        question: 'Can I try Supercheck before Cloud launches?',
        answer: 'Yes. Explore the free live demo without signing up, or self-host the open-source core today. Cloud plans are coming soon; signups are not open yet. Join the waitlist from a plan above and we will reply when they open.',
    },
    ...trialFaqs(),
    {
        question: 'Can I self-host Supercheck?',
        answer: 'Yes. Supercheck core is open source under AGPLv3. Self-host it on your own infrastructure with no Supercheck license cost; you pay for your own infrastructure and AI provider usage. The Cloud plans on this page are for teams that prefer a managed service. Self-hosted deployments have no trial and no usage limits.',
    },
    {
        question: 'Does one subscription cover all my projects?',
        answer: 'Yes. Projects in an organization share one subscription, usage allowances, member limits, and spending controls, so creating another project does not require another plan. Only the organization owner manages billing.',
    },
    {
        question: 'Where do Cloud checks run?',
        answer: 'HTTP, SSL, ping, and port monitors can run from Europe, North America, and Asia Pacific. Browser synthetic monitors, Playwright tests, and k6 load tests run in Europe. Enterprise can use custom locations, and self-hosted deployments can run checks wherever you deploy.',
    },
    {
        question: 'Why do browser checks and k6 tests run only in Europe?',
        answer: 'At launch, browser and k6 execution is available in Europe only. They can still test any public URL worldwide, and each run currently uses your browser minutes or VU-minutes once. If browser execution is enabled in more locations later, each location counts separately. Enterprise and self-hosted deployments can use other locations.',
    },
    {
        question: 'How are browser minutes measured?',
        answer: 'Playwright tests and synthetic monitors share the browser-minute allowance. Execution time is measured in milliseconds and rounded to four decimal places in minutes per run, with no whole-minute minimum. A five-second run uses 0.0833 minutes. Browser checks currently run from one location (Europe). If they are enabled in more locations, each location adds usage, and each executed retry adds usage, including failed or canceled executions that used compute. HTTP, SSL, ping, and port checks from any location do not use browser minutes.',
    },
    {
        question: 'How is k6 usage measured?',
        answer: 'Each run uses peak virtual users multiplied by its duration in minutes, rounded up to a whole VU-minute. This measures peak capacity, so ramping tests can use more than their average active VU-time suggests. Review your load profile before running large tests.',
    },
    {
        question: 'How do AI credits work?',
        answer: 'AI credits cover test generation, fixes, and failure analysis, subject to fair use. Each accepted action uses one credit, even if generation or analysis later fails. Credits have no overage charges: upgrade or wait for the next billing cycle when they run out.',
    },
    {
        question: 'What counts as an AI SRE investigation?',
        answer: 'Each completed full investigation report uses one investigation unit. Failed or timed-out investigations and billing retries do not use units. AI SRE chat, triage, and evidence briefs do not use investigation units. A completed report does not guarantee a diagnosis or resolution.',
    },
    {
        question: 'Can I limit overage spending?',
        answer: 'Owners and admins can set monthly spending limits and alerts, with optional blocking of new billable executions and full investigations. Basic uptime checks continue. Spending limits cover overages, not the subscription fee. In-flight usage can exceed the limit, so it is not a guaranteed invoice cap. Monitor, member, project, and status-page limits require a plan upgrade.',
    },
    {
        question: 'What happens if I exceed my limits?',
        answer: 'Playwright minutes, k6 VU-minutes, and completed AI SRE investigations are billed at the overage rates above. AI credits are included with no overage charges. Monitor, member, project, and status-page limits require a plan upgrade rather than an overage payment.',
    },
    {
        question: 'Do unused allowances roll over?',
        answer: 'No. Execution minutes, AI credits, and investigation allowances reset monthly on your billing date.',
    },
    {
        question: 'Can I change plans?',
        answer: 'You can change plans through the billing portal once Cloud subscriptions are available. Review the effective date and any prorated charge before confirming.',
    },
];

const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
};

function FAQItem({ question, answer }: { question: string; answer: string }) {
    return (
        <details className="group border-b border-fd-border last:border-0">
            <summary className="w-full flex cursor-pointer list-none items-center justify-between px-6 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-medium">{question}</span>
                <ChevronDown aria-hidden="true" className="w-4 h-4 text-fd-muted-foreground transition-transform flex-shrink-0 ml-4 group-open:rotate-180" />
            </summary>
            <div className="px-6 pb-4 text-fd-muted-foreground text-sm">
                {answer}
            </div>
        </details>
    );
}

const sectionHeading = 'text-2xl font-semibold tracking-tight';

function CheckIcon() {
    return (
        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-fd-primary" />
    );
}

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }}
            />
            <SiteHeader />

            <main className="mx-auto w-full max-w-6xl px-4 pt-16 pb-24 sm:px-6 md:pt-20">
                <div className="mx-auto mb-10 max-w-2xl text-center">
                    <p className="text-sm font-medium text-fd-primary">Supercheck Cloud is coming soon</p>
                    <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                        Free to self-host. Simple plans for Cloud.
                    </h1>
                    <p className="mt-4 text-pretty text-lg text-fd-muted-foreground">
                        Run the open-source core on your own servers at no cost, or preview the Cloud plans and join the waitlist. Cloud signups are not open yet.
                    </p>
                    <p className="mt-3 text-sm text-fd-muted-foreground">
                        Prices in USD per month, before taxes. Playwright minutes, k6 VU-minutes, and completed AI SRE investigations beyond the included allowance are billed at the{' '}
                        <a href="#overage" className="underline underline-offset-4 hover:text-fd-foreground">overage rates</a>.
                    </p>
                    <nav aria-label="Pricing sections" className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-medium text-fd-primary">
                        <a href="#compare" className="underline underline-offset-4">Compare plans</a>
                        <a href="#overage" className="underline underline-offset-4">Overage rates</a>
                        <Link href="/docs/app/admin/subscription" className="underline underline-offset-4">How billing works</Link>
                    </nav>
                </div>

                <section aria-labelledby="self-host-heading" className="mb-6 flex flex-col gap-6 rounded-xl border border-fd-border bg-fd-card p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
                    <div className="max-w-2xl">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <h2 id="self-host-heading" className="text-lg font-semibold">Self-hosted</h2>
                            <span className="text-2xl font-semibold tracking-tight">$0</span>
                            <span className="text-sm text-fd-muted-foreground">open source, AGPLv3</span>
                        </div>
                        <p className="mt-2 text-sm text-fd-muted-foreground">
                            Run the open-source core with no license fee and no usage limits. You pay only for your servers and AI provider.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-3">
                        <Link href="/docs/app/deployment/self-hosted" className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary">
                            Self-hosting guide
                        </Link>
                        <Link href="https://github.com/supercheck-io/supercheck" target="_blank" rel="noopener noreferrer" className="rounded-md border border-fd-border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary">
                            View on GitHub
                        </Link>
                    </div>
                </section>

                <div id="waitlist" className="grid scroll-mt-20 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`flex flex-col rounded-xl border bg-fd-card p-6 sm:p-8 ${plan.highlighted
                                ? 'border-fd-primary ring-1 ring-fd-primary'
                                : 'border-fd-border'
                                }`}
                        >
                            <h2 className="text-lg font-semibold">{plan.name}</h2>
                            <p className="mt-1 min-h-10 text-sm text-fd-muted-foreground">{plan.description}</p>
                            <div className="mt-6 flex h-12 items-baseline gap-1">
                                <span className="text-4xl font-semibold tracking-tight">{plan.price ?? 'Custom'}</span>
                                {plan.period && <span className="text-sm text-fd-muted-foreground">{plan.period}</span>}
                            </div>
                            <Link
                                href={plan.ctaLink}
                                className={`mt-6 block w-full rounded-md px-4 py-2.5 text-center text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary ${plan.highlighted
                                    ? 'bg-fd-primary text-fd-primary-foreground hover:opacity-90'
                                    : 'border border-fd-border hover:bg-fd-accent'
                                    }`}
                            >
                                {plan.cta}
                            </Link>
                            <ul className="mt-8 space-y-3 border-t border-fd-border pt-6">
                                {plan.features.map((feature) => {
                                    const text = typeof feature === 'string' ? feature : feature.text;
                                    const hint = typeof feature === 'string' ? null : feature.hint;
                                    return (
                                        <li key={text} className="flex items-start gap-3 text-sm leading-6">
                                            <CheckIcon />
                                            <span className="min-w-0">
                                                {text}
                                                {hint && <span className="block text-xs text-fd-muted-foreground">{hint}</span>}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>

                <CopyEmail email={WAITLIST_EMAIL} />

                <section aria-labelledby="trial-heading" className="mt-6 rounded-xl border border-fd-border p-6 sm:p-8">
                    <h2 id="trial-heading" className="text-lg font-semibold">{trial.durationDays}-day free trial, no card required</h2>
                    <p className="mt-1 text-sm text-fd-muted-foreground">
                        Most of the product, with limits that keep the trial safe for everyone. Custom domains and single sign-on are on paid plans. Trials start when Cloud signups open.
                    </p>
                    <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        {trialHighlights().map((highlight) => (
                            <li key={highlight} className="flex items-start gap-3 leading-6">
                                <CheckIcon />
                                <span>{highlight}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-5 text-xs text-fd-muted-foreground">
                        When the trial ends, monitors are paused and status pages are archived. Nothing is deleted, and subscribing restores them.
                    </p>
                </section>

                <section id="compare" aria-labelledby="compare-heading" className="mt-24 scroll-mt-20">
                    <div className="mx-auto mb-8 max-w-2xl text-center">
                        <h2 id="compare-heading" className={sectionHeading}>Compare plans</h2>
                    </div>
                    <p className="mb-4 text-center text-sm text-fd-muted-foreground md:hidden">Scroll horizontally to compare all plans.</p>
                    <div className="relative overflow-x-auto rounded-xl border border-fd-border" role="region" aria-label="Plan feature comparison" tabIndex={0}>
                        <table className="w-full min-w-[640px] text-sm" aria-label="Full plan feature comparison">
                            <thead>
                                <tr className="border-b border-fd-border">
                                    <th className="w-2/5 px-6 py-4 text-left font-medium">Feature</th>
                                    <th className="px-6 py-4 text-center font-medium">Plus</th>
                                    <th className="px-6 py-4 text-center font-medium">Pro</th>
                                    <th className="px-6 py-4 text-center font-medium">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody>
                                {comparisonFeatures.map((category) => (
                                    <React.Fragment key={category.category}>
                                        <tr className="border-b border-fd-border bg-fd-muted/40">
                                            <th scope="colgroup" colSpan={4} className="px-6 py-2.5 text-left text-xs font-medium text-fd-muted-foreground">
                                                {category.category}
                                            </th>
                                        </tr>
                                        {category.items.map((item) => (
                                            <tr key={item.name} className="border-b border-fd-border last:border-0">
                                                <th scope="row" className="px-6 py-3 text-left font-normal">
                                                    {item.name}
                                                    {item.hint && <span className="block max-w-sm text-xs text-fd-muted-foreground">{item.hint}</span>}
                                                </th>
                                                <td className="px-6 py-3 text-center"><ComparisonCell value={item.plus} /></td>
                                                <td className="px-6 py-3 text-center"><ComparisonCell value={item.pro} /></td>
                                                <td className="px-6 py-3 text-center"><ComparisonCell value={item.enterprise} /></td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section id="overage" aria-labelledby="overage-heading" className="mt-24 scroll-mt-20">
                    <div className="mx-auto mb-8 max-w-2xl text-center">
                        <h2 id="overage-heading" className={sectionHeading}>Overage rates</h2>
                        <p className="mt-3 text-fd-muted-foreground">
                            Charged only for usage beyond your monthly allowance. Owners can set spending limits and alerts; in-flight usage can still exceed a limit.
                        </p>
                    </div>
                    <div className="relative mx-auto max-w-3xl overflow-x-auto rounded-xl border border-fd-border" role="region" aria-label="Usage overage pricing" tabIndex={0}>
                        <table className="w-full text-sm" aria-label="Usage overage rates">
                            <thead>
                                <tr className="border-b border-fd-border">
                                    <th className="px-6 py-4 text-left font-medium">Usage</th>
                                    <th className="px-6 py-4 text-right font-medium">Plus</th>
                                    <th className="px-6 py-4 text-right font-medium">Pro</th>
                                </tr>
                            </thead>
                            <tbody>
                                {overagePricing.map((item) => (
                                    <tr key={item.metric} className="border-b border-fd-border last:border-0">
                                        <th scope="row" className="px-6 py-3 text-left font-normal">{item.metric}</th>
                                        <td className="px-6 py-3 text-right tabular-nums">{item.plus}</td>
                                        <td className="px-6 py-3 text-right tabular-nums">{item.pro}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <VendorComparison />

                <section aria-labelledby="faq-heading" className="mx-auto mt-24 max-w-3xl">
                    <div className="mb-8 text-center">
                        <h2 id="faq-heading" className={sectionHeading}>Frequently asked questions</h2>
                        <p className="mt-3 text-fd-muted-foreground">
                            Something else? Email{' '}
                            <a href={mailtoHref('Supercheck question')} className="underline underline-offset-4 hover:text-fd-foreground">{WAITLIST_EMAIL}</a>
                            {' '}or try the{' '}
                            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-fd-foreground">live demo</a>.
                        </p>
                    </div>
                    <div className="rounded-xl border border-fd-border">
                        {faqs.map((faq) => (
                            <FAQItem key={faq.question} question={faq.question} answer={faq.answer} />
                        ))}
                    </div>
                </section>
            </main>

            <SiteFooter />
        </div>
    );
}
