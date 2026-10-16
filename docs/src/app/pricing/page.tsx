import React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { SiteHeader } from '../../lib/layout.shared';
import { CostCalculator } from '../../components/pricing/cost-calculator';
import { CapabilityComparison } from '../../components/pricing/capability-comparison';

type Feature = string | { text: string; hint: string };

const WAITLIST_EMAIL = 'hello@supercheck.io';

function waitlistHref(plan: string) {
    const subject = encodeURIComponent(`Supercheck Cloud waitlist (${plan})`);
    const body = encodeURIComponent(
        `Please add me to the Supercheck Cloud waitlist for the ${plan} plan.`,
    );
    return `mailto:${WAITLIST_EMAIL}?subject=${subject}&body=${body}`;
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
        name: 'Plus',
        price: '$49',
        period: '/month',
        description: 'For startups and small teams',
        features: [
            '50 monitors',
            '5 status pages with custom domains',
            { text: 'Monitoring from EU, US and Singapore', hint: 'Browser checks and k6 run in EU' },
            { text: '3,000 Playwright minutes/month', hint: '≈ 36,000 five-second test runs' },
            '30,000 k6 VU minutes/month',
            '1,000 AI credits/month',
            '200 completed AI SRE investigations/month',
            '5 team members',
            '10 projects per organization',
            'Email support',
        ],
        cta: 'Join the Plus waitlist',
        ctaLink: waitlistHref('Plus'),
        highlighted: false,
    },
    {
        name: 'Pro',
        price: '$149',
        period: '/month',
        description: 'For growing teams',
        features: [
            '200 monitors',
            '20 status pages with custom domains',
            { text: 'Monitoring from EU, US and Singapore', hint: 'Browser checks and k6 run in EU' },
            { text: '10,000 Playwright minutes/month', hint: '≈ 120,000 five-second test runs' },
            '100,000 k6 VU minutes/month',
            '5,000 AI credits/month',
            '1,000 completed AI SRE investigations/month',
            '25 team members',
            '50 projects per organization',
            'Priority email support',
        ],
        cta: 'Join the Pro waitlist',
        ctaLink: waitlistHref('Pro'),
        highlighted: true,
    },
    {
        name: 'Enterprise',
        description: 'Get in touch to discuss your requirements',
        features: [
            'Custom monitor allowance',
            'Custom monitoring locations',
            'Custom Playwright & k6 allowances',
            'Custom AI credit pool or bring-your-own-provider',
            'Custom AI SRE investigation volume',
            'Custom connector and Private Agent limits',
            'Custom team member & project limits',
            'Custom data retention policies',
            'Dedicated account manager',
            'Custom SLA & priority support',
            'Onboarding & training',
        ],
        cta: 'Get in touch',
        ctaLink: `mailto:${WAITLIST_EMAIL}`,
        highlighted: false,
    },
];

const overagePricing = [
    { metric: 'Playwright minute', plus: '$0.01', pro: '$0.005' },
    { metric: '1,000 k6 VU-minutes', plus: '$2.00', pro: '$1.00' },
    { metric: 'Completed AI SRE investigation', plus: '$0.10', pro: '$0.10' },
    { metric: 'AI credits', plus: 'No overage', pro: 'No overage' },
];

const CHECK = '✓';
const NONE = '—';
const CUSTOM = 'Custom';

interface ComparisonItem {
    name: string;
    plus: string;
    pro: string;
    enterprise: string;
}

const comparisonFeatures: { category: string; items: ComparisonItem[] }[] = [
    {
        category: 'Usage Limits', items: [
            { name: 'Monitors', plus: '50', pro: '200', enterprise: CUSTOM },
            { name: 'Playwright minutes/month', plus: '3,000', pro: '10,000', enterprise: CUSTOM },
            { name: 'k6 VU minutes/month', plus: '30,000', pro: '100,000', enterprise: CUSTOM },
            { name: 'AI credits/month', plus: '1,000', pro: '5,000', enterprise: CUSTOM },
            { name: 'Completed AI SRE investigations/month', plus: '200', pro: '1,000', enterprise: CUSTOM },
            { name: 'Read-only evidence connectors', plus: 'Included', pro: 'Included', enterprise: CUSTOM },
            { name: 'Private Agent support', plus: 'Included', pro: 'Included', enterprise: CUSTOM },
            { name: 'Concurrent jobs', plus: '5', pro: '10', enterprise: CUSTOM },
            { name: 'Queued jobs', plus: '50', pro: '100', enterprise: CUSTOM },
            { name: 'Minimum check interval', plus: '1 minute', pro: '1 minute', enterprise: CUSTOM },
            { name: 'Minimum synthetic check interval', plus: '5 minutes', pro: '5 minutes', enterprise: CUSTOM },
            { name: 'HTTP, SSL, ping and port monitoring locations', plus: 'EU, US, Singapore', pro: 'EU, US, Singapore', enterprise: CUSTOM },
            { name: 'Browser checks, Playwright tests and k6 execution', plus: 'EU', pro: 'EU', enterprise: CUSTOM },
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
        category: 'Team & Projects', items: [
            { name: 'Team members', plus: '5', pro: '25', enterprise: CUSTOM },
            { name: 'Projects', plus: '10', pro: '50', enterprise: CUSTOM },
            { name: 'Status pages', plus: '5', pro: '20', enterprise: CUSTOM },
            { name: 'Subscribers per status page', plus: '1,000', pro: '10,000', enterprise: CUSTOM },
        ]
    },
    {
        category: 'Data Retention', items: [
            { name: 'Raw monitor data', plus: '7 days', pro: '7 days', enterprise: CUSTOM },
            { name: 'Aggregated metrics', plus: '30 days', pro: '90 days', enterprise: CUSTOM },
            { name: 'Job run history', plus: '30 days', pro: '90 days', enterprise: CUSTOM },
        ]
    },
    {
        category: 'Features & Support', items: [
            { name: 'Custom domains', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'CI/CD integration', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Cron job scheduling', plus: CHECK, pro: CHECK, enterprise: CHECK },
            { name: 'Support', plus: 'Email', pro: 'Priority email', enterprise: 'Custom SLA' },
            { name: 'Dedicated account manager', plus: NONE, pro: NONE, enterprise: CHECK },
            { name: 'Onboarding & training', plus: NONE, pro: NONE, enterprise: CHECK },
        ]
    },
];

function ComparisonCell({ value }: { value: string }) {
    if (value === CHECK) {
        return (
            <>
                <span aria-hidden="true" className="text-fd-primary">{CHECK}</span>
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

const faqs = [
    {
        question: 'Can I try Supercheck before Cloud launches?',
        answer: 'Yes. Explore the free live demo without signing up, or self-host the open-source core today. Cloud plans are coming soon; signups are not open yet. Join the waitlist from a plan above and we will reply when they open.',
    },
    {
        question: 'Can I self-host Supercheck?',
        answer: 'Yes. Supercheck core is open source under AGPLv3. Self-host it on your own infrastructure with no Supercheck license cost; you pay for your own infrastructure and AI provider usage. The Cloud plans on this page are for teams that prefer a managed service.',
    },
    {
        question: 'Does one subscription cover all my projects?',
        answer: 'Yes. Projects in an organization share one subscription, usage allowances, member limits, and spending controls, so creating another project does not require another plan. Only the organization owner manages billing.',
    },
    {
        question: 'Where do Cloud checks run?',
        answer: 'HTTP, SSL, ping, and port monitoring runs from EU, US, and Singapore. Browser synthetic checks, Playwright tests, and k6 execution run in EU. Enterprise can use custom locations, and self-hosted deployments can run checks wherever you deploy.',
    },
    {
        question: 'How are browser minutes measured?',
        answer: 'Playwright tests and synthetic monitors share the browser-minute allowance. Execution time is measured in milliseconds and rounded to four decimal places in minutes per run, with no whole-minute minimum. A five-second run uses 0.0833 minutes. Browser checks currently run from one location (EU). If they are enabled in more locations, each location adds usage, and each executed retry adds usage, including failed or canceled executions that used compute. HTTP, ping, and port checks do not use browser minutes.',
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

function FAQItem({ question, answer }: { question: string; answer: string }) {
    return (
        <details className="group border-b border-fd-border last:border-0">
            <summary className="w-full flex cursor-pointer list-none items-center justify-between px-6 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary [&::-webkit-details-marker]:hidden">
                <span className="text-sm">{question}</span>
                <ChevronDown aria-hidden="true" className="w-4 h-4 text-fd-muted-foreground transition-transform flex-shrink-0 ml-4 group-open:rotate-180" />
            </summary>
            <div className="px-6 pb-4 text-fd-muted-foreground text-sm">
                {answer}
            </div>
        </details>
    );
}

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader showPricing={false} />

            <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
                {/* Header */}
                <div className="mx-auto mb-12 max-w-3xl text-center">
                    <h1 className="mb-5 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                        Supercheck Cloud is coming soon
                    </h1>
                    <p className="text-lg text-fd-muted-foreground max-w-2xl mx-auto">
                        Preview the plans below and join the waitlist for the plan you want. Cloud signups are not open yet.
                    </p>
                    <p className="mt-4 text-sm text-fd-muted-foreground">
                        Prices are in USD per month, before taxes. Usage beyond included allowances is billed separately.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div id="waitlist" className="mb-4 grid scroll-mt-20 gap-8 md:grid-cols-2 lg:grid-cols-3">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative flex flex-col rounded-xl border p-6 sm:p-8 ${plan.highlighted
                                ? 'border-fd-primary bg-fd-primary/5'
                                : 'border-fd-border bg-fd-card'
                                }`}
                        >
                            {plan.highlighted && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <span className="bg-fd-primary text-fd-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                                        Higher capacity
                                    </span>
                                </div>
                            )}
                            <div className="mb-6 min-h-20">
                                <h2 className="text-xl font-semibold mb-2">{plan.name}</h2>
                                <p className="text-sm text-fd-muted-foreground">{plan.description}</p>
                            </div>
                            <div className="mb-6 flex min-h-14 items-baseline gap-1">
                                <span className="text-4xl font-bold">{plan.price ?? 'Custom'}</span>
                                {plan.period && (
                                    <span className="text-fd-muted-foreground">{plan.period}</span>
                                )}
                            </div>
                            <ul className="mb-8 flex-1 space-y-3">
                                {plan.features.map((feature) => {
                                    const text = typeof feature === 'string' ? feature : feature.text;
                                    const hint = typeof feature === 'string' ? null : feature.hint;
                                    return (
                                    <li key={text} className="flex items-start gap-3 text-sm leading-6">
                                        <svg aria-hidden="true" className="mt-1 size-4 shrink-0 text-fd-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span className="min-w-0">
                                            {text}
                                            {hint && <span className="block text-xs text-fd-muted-foreground">{hint}</span>}
                                        </span>
                                    </li>
                                    );
                                })}
                            </ul>
                            <Link
                                href={plan.ctaLink}
                                className={`block w-full rounded-lg px-4 py-3 text-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary ${plan.highlighted
                                    ? 'bg-fd-primary text-fd-primary-foreground hover:opacity-90'
                                    : 'bg-fd-secondary hover:bg-fd-secondary/80'
                                    }`}
                            >
                                {plan.cta}
                            </Link>
                        </div>
                    ))}
                </div>

                <p className="mb-16 text-center text-xs text-fd-muted-foreground">
                    Waitlist buttons open an email to {WAITLIST_EMAIL}.
                </p>

                {/* Self-hosting */}
                <aside aria-labelledby="self-host-heading" className="mb-20 flex flex-col items-start justify-between gap-4 rounded-xl border border-fd-border bg-fd-card p-6 sm:flex-row sm:items-center sm:p-8">
                    <div className="max-w-2xl">
                        <h2 id="self-host-heading" className="mb-1 text-lg font-semibold">Prefer to run it yourself?</h2>
                        <p className="text-sm text-fd-muted-foreground">
                            Supercheck core is open source under AGPLv3. Self-host it with no license fee; you pay for your own infrastructure and AI provider.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-3">
                        <Link href="/docs/app/deployment/self-hosted" className="rounded-lg bg-fd-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-secondary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary">
                            Self-hosting guide
                        </Link>
                        <Link href="https://github.com/supercheck-io/supercheck" target="_blank" rel="noopener noreferrer" className="rounded-lg border border-fd-border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary">
                            View on GitHub
                        </Link>
                    </div>
                </aside>

                <CostCalculator />

                <CapabilityComparison />

                {/* Overage Pricing */}
                <div className="mb-20">
                    <h2 className="text-2xl font-bold text-center mb-8">Overage Pricing</h2>
                    <p className="text-center text-fd-muted-foreground mb-8 max-w-2xl mx-auto">
                        Prices are in USD before applicable taxes. Usage beyond your allowance is billed at the rates below.
                    </p>
                    <div className="max-w-2xl mx-auto">
                        <div className="rounded-lg border overflow-x-auto" role="region" aria-label="Usage overage pricing" tabIndex={0}>
                            <table className="w-full" aria-label="Usage overage rates">
                                <thead className="bg-fd-muted">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-sm font-medium">Metric</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Plus</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Pro</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {overagePricing.map((item, idx) => (
                                        <tr key={item.metric} className={idx % 2 === 0 ? 'bg-fd-card' : 'bg-fd-muted/50'}>
                                            <td className="px-6 py-3 text-sm">{item.metric}</td>
                                            <td className="px-6 py-3 text-sm text-center font-medium">{item.plus}</td>
                                            <td className="px-6 py-3 text-sm text-center font-medium">{item.pro}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Comparison Table */}
                <div className="mb-20">
                    <h2 className="text-2xl font-bold text-center mb-8">Full Feature Comparison</h2>
                    <p className="text-center text-sm text-fd-muted-foreground mb-4 md:hidden">Scroll horizontally to compare all plans.</p>
                    <div className="relative rounded-lg border overflow-x-auto" role="region" aria-label="Plan feature comparison" tabIndex={0}>
                            <table className="w-full min-w-[640px]" aria-label="Full plan feature comparison">
                                <thead className="bg-fd-muted">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-sm font-medium">Feature</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Plus</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Pro</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Enterprise</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisonFeatures.map((category) => (
                                        <React.Fragment key={category.category}>
                                            <tr className="bg-fd-muted/50 border-l-2 border-l-fd-primary/50">
                                                <td colSpan={4} className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
                                                    {category.category}
                                                </td>
                                            </tr>
                                            {category.items.map((item, idx) => (
                                                <tr key={item.name} className={idx % 2 === 0 ? 'bg-fd-card' : 'bg-fd-muted/30'}>
                                                    <th scope="row" className="px-6 py-3 pl-10 text-left text-sm font-normal">{item.name}</th>
                                                    <td className="px-6 py-3 text-sm text-center"><ComparisonCell value={item.plus} /></td>
                                                    <td className="px-6 py-3 text-sm text-center"><ComparisonCell value={item.pro} /></td>
                                                    <td className="px-6 py-3 text-sm text-center"><ComparisonCell value={item.enterprise} /></td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                    </div>
                </div>

                {/* FAQ with Accordion */}
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-8">Frequently Asked Questions</h2>
                    <div className="rounded-lg border bg-fd-card">
                        {faqs.map((faq) => (
                            <FAQItem key={faq.question} question={faq.question} answer={faq.answer} />
                        ))}
                    </div>
                </div>
                <nav aria-label="Pricing resources" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-fd-muted-foreground">
                    <Link href="https://demo.supercheck.dev" className="hover:underline">Try the demo</Link>
                    <Link href="/terms" className="hover:underline">Terms of Service</Link>
                    <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
                    <Link href="mailto:hello@supercheck.io" className="hover:underline">Contact us</Link>
                </nav>
            </main>
        </div>
    );
}
