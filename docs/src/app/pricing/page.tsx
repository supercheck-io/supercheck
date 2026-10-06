import React from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { SiteHeader } from '../../lib/layout.shared';

const plans = [
    {
        name: 'Self-Hosted',
        price: 'Free',
        description: 'No license cost; infrastructure and AI provider costs apply',
        features: [
            'Unlimited monitors',
            'Unlimited Playwright minutes',
            'Unlimited K6 VU minutes',
            'Unlimited AI feature usage with your own provider key',
            'Unlimited AI SRE investigations on your infrastructure',
            'Unlimited read-only evidence connectors',
            'Unlimited team members',
            'Unlimited projects in your default organization',
            'CI/CD integration',
            'Cron job scheduling',
            'Community support',
        ],
        cta: 'Deploy Now',
        ctaLink: '/docs/app/deployment/self-hosted',
        highlighted: false,
    },
    {
        name: 'Plus',
        price: '$49',
        period: '/month',
        description: 'For startups and small teams',
        features: [
            '25 monitors',
            '3,000 Playwright minutes/month',
            '20,000 K6 VU minutes/month',
            '100 AI credits/month',
            '25 completed AI SRE investigations/month',
            'Read-only evidence connectors',
            'Private Agent support',
            '5 team members',
            '10 projects per organization',
            'CI/CD integration',
            'Cron job scheduling',
            'Email support',
        ],
        cta: 'Get Started',
        ctaLink: 'https://app.supercheck.io/sign-up',
        highlighted: false,
    },
    {
        name: 'Pro',
        price: '$149',
        period: '/month',
        description: 'For growing teams',
        features: [
            '100 monitors',
            '10,000 Playwright minutes/month',
            '75,000 K6 VU minutes/month',
            '300 AI credits/month',
            '100 completed AI SRE investigations/month',
            'Read-only evidence connectors',
            'Private Agent support',
            '25 team members',
            '50 projects per organization',
            'CI/CD integration',
            'Cron job scheduling',
            'Priority email support',
        ],
        cta: 'Get Started',
        ctaLink: 'https://app.supercheck.io/sign-up',
        highlighted: true,
    },
    {
        name: 'Enterprise',
        description: 'Get in touch to discuss your requirements',
        features: [
            'Custom monitor allowance',
            'Custom Playwright & K6 allowances',
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
        ctaLink: 'mailto:hello@supercheck.io',
        highlighted: false,
    },
];

const overagePricing = [
    { metric: 'Playwright minute', plus: '$0.03', pro: '$0.02' },
    { metric: 'K6 VU minute', plus: '$0.005', pro: '$0.0025' },
    { metric: 'AI credit', plus: 'Hard limit', pro: 'Hard limit' },
    { metric: 'Completed AI SRE investigation', plus: '$0.50', pro: '$0.50' },
];

const comparisonFeatures = [
    {
        category: 'Usage Limits', items: [
            { name: 'Monitors', plus: '25', pro: '100', selfHosted: 'Unlimited' },
            { name: 'Playwright minutes/month', plus: '3,000', pro: '10,000', selfHosted: 'Unlimited' },
            { name: 'K6 VU minutes/month', plus: '20,000', pro: '75,000', selfHosted: 'Unlimited' },
            { name: 'AI credits/month', plus: '100', pro: '300', selfHosted: 'Unlimited with BYO provider' },
            { name: 'Completed AI SRE investigations/month', plus: '25', pro: '100', selfHosted: 'Unlimited' },
            { name: 'Read-only evidence connectors', plus: 'Included', pro: 'Included', selfHosted: 'Self-managed' },
            { name: 'Private Agent support', plus: 'Included', pro: 'Included', selfHosted: 'Self-managed' },
            { name: 'Concurrent jobs', plus: '5', pro: '10', selfHosted: 'Configurable' },
            { name: 'Queued jobs', plus: '50', pro: '100', selfHosted: 'Configurable' },
            { name: 'Minimum check interval', plus: '1 minute', pro: '1 minute', selfHosted: '1 minute' },
            { name: 'Minimum synthetic check interval', plus: '5 minutes', pro: '5 minutes', selfHosted: '5 minutes' },
        ]
    },
    {
        category: 'AI SRE', items: [
            { name: 'Standalone AI SRE Copilot', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Incident-scoped Copilot', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Evidence graph and reports', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Report snapshots and feedback', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Read-only connector evidence', plus: 'Included', pro: 'Included', selfHosted: 'Self-managed' },
        ]
    },
    {
        category: 'Team & Organization', items: [
            { name: 'Team members', plus: '5', pro: '25', selfHosted: 'Unlimited' },
            { name: 'Cloud subscription scope', plus: 'One organization', pro: 'One organization', selfHosted: 'Self-managed' },
            { name: 'Projects', plus: '10', pro: '50', selfHosted: 'Unlimited' },
            { name: 'Status pages', plus: '3', pro: '15', selfHosted: 'Unlimited' },
            { name: 'Subscribers per status page', plus: '500', pro: '5,000', selfHosted: 'Unlimited' },
        ]
    },
    {
        category: 'Data Retention', items: [
            { name: 'Raw monitor data', plus: '7 days', pro: '7 days', selfHosted: '7 days by default' },
            { name: 'Aggregated metrics', plus: '30 days', pro: '90 days', selfHosted: '90 days by default' },
            { name: 'Job run history', plus: '30 days', pro: '90 days', selfHosted: '90 days by default' },
        ]
    },
    {
        category: 'Features', items: [
            { name: 'Custom domains', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'CI/CD integration', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Cron job scheduling', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Available monitoring locations', plus: 'All enabled locations', pro: 'All enabled locations', selfHosted: 'Self-managed' },
            { name: 'Support', plus: 'Email', pro: 'Priority email', selfHosted: 'Community' },
        ]
    },
];

const faqs = [
    {
        question: 'Does one subscription cover the projects in my organization?',
        answer: 'Yes. Your account has one default organization, and its projects share the subscription, usage allowances, limits, and spending controls. Create and switch projects using the project selector. Projects you join by invitation use their host team’s plan and allowances separately; joining a paid team does not require a personal subscription. Only the host organization’s owner can manage billing.',
    },
    {
        question: 'When should I consider Pro?',
        answer: 'Pro includes more capacity and lower Playwright and K6 overage rates. At standard list prices, with only browser usage, Plus and Pro cost the same at about 6,333 Playwright minutes/month. With only K6 usage, they cost the same at 40,000 VU-minutes/month. Other usage, discounts, taxes, and proration affect the comparison; review your organization’s estimate before changing plans.',
    },
    {
        question: 'How are browser execution minutes measured?',
        answer: 'Playwright tests and synthetic monitors share your minute allowance. We measure execution milliseconds and round to four decimal places in minutes per run, without a whole-minute minimum. A five-second run uses 0.0833 minutes. Each location and executed retry contributes usage. HTTP, ping, and port checks do not consume these minutes. Failed or canceled executions can still consume compute usage.',
    },
    {
        question: 'What does frequent synthetic monitoring cost?',
        answer: 'Five monitors running for five seconds every five minutes in one location use approximately 3,599 Playwright minutes in a 30-day month: about $66.96 total on Plus, or within Pro’s $149 allowance. Longer runs, additional locations, retries, and other tests increase usage. This is an estimate before taxes.',
    },
    {
        question: 'How are load tests measured?',
        answer: 'K6 usage measures peak capacity, not accumulated active VU-time: peak virtual users multiplied by execution duration in minutes, rounded up to a whole VU-minute per run. This can exceed average active VU-time for ramping tests. Review your load profile and spending settings before running a large test.',
    },
    {
        question: 'Can I try Supercheck before subscribing?',
        answer: 'Yes! Try our free demo at demo.supercheck.dev \u2014 no signup required. When you\u2019re ready, choose a plan to get started.',
    },
    {
        question: 'Do unused minutes roll over?',
        answer: 'No. Execution minutes, AI credits, and AI SRE investigation allowances reset monthly on your billing date.',
    },
    {
        question: 'How do AI credits work?',
        answer: 'AI credits are a hard monthly pool for test generation, test fixes, and failure analysis. Each accepted action uses one credit before generation or analysis starts, even if it later fails. There are no AI credit overages; upgrade or wait for your next billing cycle when the pool is exhausted. Full AI SRE investigations use a separate allowance: each completed report uses one investigation unit, without guaranteeing a diagnosis or resolution. Failed or timed-out full investigations and billing retries do not consume investigation units. AI SRE chat, triage, and evidence briefs do not consume investigation units.',
    },
    {
        question: 'How can I control overage spending?',
        answer: 'Organization owners and admins can configure a monthly spending limit, billing contacts, threshold alerts, and optional blocking of new billable executions and full investigations. Basic uptime checks continue at the spending limit. Only the owner can manage the paid subscription. Limits apply to usage overages in addition to the base subscription. In-flight execution usage can exceed a configured limit, so it is not a guaranteed invoice cap. Monitor, member, project, and status-page limits require an upgrade rather than an overage payment.',
    },
    {
        question: 'Can I change plans anytime?',
        answer: 'Yes. Review the effective date and any prorated charge in the billing portal before confirming a plan change.',
    },
    {
        question: 'What payment methods do you accept?',
        answer: 'We accept all major credit cards (Visa, Mastercard, American Express) through our payment provider.',
    },
    {
        question: 'Is the self-hosted version really free?',
        answer: 'Yes. Supercheck core is open source under AGPLv3. Self-host on your infrastructure with unlimited Supercheck usage at no license cost. You still pay your own infrastructure and AI provider costs.',
    },
    {
        question: 'Do you offer enterprise plans?',
        answer: 'Get in touch at hello@supercheck.io to discuss your requirements, usage allowances, support, SLA, and onboarding.',
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

            <main className="container mx-auto px-4 sm:px-6 py-12 md:py-20">
                {/* Header */}
                <div className="text-center mb-16">
                    <h1 className="text-4xl font-bold tracking-tight mb-4">
                        Simple, Transparent Pricing
                    </h1>
                    <p className="text-lg text-fd-muted-foreground max-w-2xl mx-auto">
                        Self-host at no license cost, or choose a monthly cloud plan for your team. One subscription covers all projects in your default organization.
                    </p>
                    <p className="mt-4 text-sm text-fd-muted-foreground">
                        Cloud prices are in USD, billed monthly, before applicable taxes. Usage overages are additional.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-6">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative flex flex-col rounded-xl border p-8 ${plan.highlighted
                                ? 'border-fd-primary bg-fd-primary/5 shadow-lg'
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
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold mb-2">{plan.name}</h2>
                                <p className="text-sm text-fd-muted-foreground">{plan.description}</p>
                            </div>
                            {plan.price !== undefined && <div className="mb-6">
                                <span className="text-4xl font-bold">{plan.price}</span>
                                {plan.period && (
                                    <span className="text-fd-muted-foreground">{plan.period}</span>
                                )}
                            </div>}
                            <ul className="space-y-3 mb-8 flex-1">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2 text-sm">
                                        <svg aria-hidden="true" className="w-5 h-5 text-fd-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                            <Link
                                href={plan.ctaLink}
                                aria-label={`${plan.cta} — ${plan.name}`}
                                className={`block w-full text-center py-3 px-4 rounded-lg font-medium transition-colors ${plan.highlighted
                                    ? 'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90'
                                    : 'bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-secondary/80'
                                    }`}
                            >
                                {plan.cta}
                            </Link>
                        </div>
                    ))}
                </div>
                <p className="text-center text-sm text-fd-muted-foreground max-w-3xl mx-auto mb-20">
                    Self-hosting requires your own infrastructure and AI provider; you pay those costs and manage capacity, security, and retention. Cloud allowances reset each billing month and do not roll over. Joining an invited team uses that team’s subscription.
                </p>

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
                    <div className="rounded-lg border overflow-x-auto" role="region" aria-label="Plan feature comparison" tabIndex={0}>
                            <table className="w-full min-w-[760px]" aria-label="Full plan feature comparison">
                                <thead className="bg-fd-muted">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-sm font-medium">Feature</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Self-Hosted</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Plus</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Pro</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Enterprise</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisonFeatures.map((category) => (
                                        <React.Fragment key={category.category}>
                                            <tr className="bg-fd-muted/50 border-l-2 border-l-fd-primary/50">
                                                <td colSpan={5} className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
                                                    {category.category}
                                                </td>
                                            </tr>
                                            {category.items.map((item, idx) => (
                                                <tr key={item.name} className={idx % 2 === 0 ? 'bg-fd-card' : 'bg-fd-muted/30'}>
                                                    <th scope="row" className="px-6 py-3 text-sm pl-10 text-left font-normal">{item.name}</th>
                                                    <td className="px-6 py-3 text-sm text-center">{item.selfHosted}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{item.plus}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{item.pro}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{(item as Record<string, string>).enterprise ?? 'Custom'}</td>
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
