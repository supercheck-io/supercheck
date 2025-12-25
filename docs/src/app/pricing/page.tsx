'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { SiteHeader } from '../../lib/layout.shared';

const plans = [
    {
        name: 'Self-Hosted',
        price: 'Free',
        description: 'Run on your own infrastructure',
        features: [
            'Unlimited monitors',
            'Unlimited Playwright minutes',
            'Unlimited K6 VU minutes',
            'Unlimited AI credits',
            'Unlimited team members',
            'Unlimited organizations & projects',
            'CI/CD integration',
            'Cron job scheduling',
            'Community support',
        ],
        cta: 'Deploy Now',
        ctaLink: '/docs/deployment',
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
            '5 team members',
            '2 organizations, 10 projects',
            'CI/CD integration',
            'Cron job scheduling',
            'Email support',
        ],
        cta: 'Get Started',
        ctaLink: 'https://demo.supercheck.io/sign-up',
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
            '25 team members',
            '10 organizations, 50 projects',
            'CI/CD integration',
            'Cron job scheduling',
            'Priority support',
        ],
        cta: 'Get Started',
        ctaLink: 'https://demo.supercheck.io/sign-up',
        highlighted: true,
    },
];

const overagePricing = [
    { metric: 'Playwright minute', plus: '$0.03', pro: '$0.02' },
    { metric: 'K6 VU minute', plus: '$0.01', pro: '$0.01' },
    { metric: 'AI credit', plus: '$0.05', pro: '$0.03' },
];

const comparisonFeatures = [
    {
        category: 'Usage Limits', items: [
            { name: 'Monitors', plus: '25', pro: '100', selfHosted: 'Unlimited' },
            { name: 'Playwright minutes/month', plus: '3,000', pro: '10,000', selfHosted: 'Unlimited' },
            { name: 'K6 VU minutes/month', plus: '20,000', pro: '75,000', selfHosted: 'Unlimited' },
            { name: 'AI credits/month', plus: '100', pro: '300', selfHosted: 'Unlimited' },
            { name: 'Concurrent jobs', plus: '5', pro: '10', selfHosted: 'Unlimited' },
        ]
    },
    {
        category: 'Team & Organization', items: [
            { name: 'Team members', plus: '5', pro: '25', selfHosted: 'Unlimited' },
            { name: 'Organizations', plus: '2', pro: '10', selfHosted: 'Unlimited' },
            { name: 'Projects', plus: '10', pro: '50', selfHosted: 'Unlimited' },
            { name: 'Status pages', plus: '3', pro: '15', selfHosted: 'Unlimited' },
        ]
    },
    {
        category: 'Data Retention', items: [
            { name: 'Raw monitor data', plus: '7 days', pro: '30 days', selfHosted: '30 days' },
            { name: 'Aggregated metrics', plus: '30 days', pro: '365 days', selfHosted: '180 days' },
            { name: 'Job run history', plus: '30 days', pro: '90 days', selfHosted: '180 days' },
        ]
    },
    {
        category: 'Features', items: [
            { name: 'Custom domains', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'SSO/SAML', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'CI/CD integration', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'Cron job scheduling', plus: '✓', pro: '✓', selfHosted: '✓' },
            { name: 'All monitoring locations', plus: '✓', pro: '✓', selfHosted: 'Self-managed' },
        ]
    },
];

const faqs = [
    {
        question: 'Do unused minutes roll over?',
        answer: 'No, plan quotas reset monthly on your billing date.',
    },
    {
        question: 'Can I change plans anytime?',
        answer: 'Yes. Upgrades take effect immediately with pro-rated billing. Downgrades apply at the next billing cycle.',
    },
    {
        question: 'What payment methods do you accept?',
        answer: 'We accept all major credit cards (Visa, Mastercard, American Express) through our payment provider.',
    },
    {
        question: 'Is the self-hosted version really free?',
        answer: 'Yes. Supercheck is open source. Self-host on your infrastructure with unlimited usage at no cost.',
    },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="border-b border-fd-border last:border-0">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-6 py-4 text-left"
            >
                <span className="text-sm">{question}</span>
                <ChevronDown className={`w-4 h-4 text-fd-muted-foreground transition-transform flex-shrink-0 ml-4 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="px-6 pb-4 text-fd-muted-foreground text-sm">
                    {answer}
                </div>
            )}
        </div>
    );
}

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-fd-background">
            <SiteHeader showPricing={false} />

            <main className="container py-12 md:py-20">
                {/* Header */}
                <div className="text-center mb-16">
                    <h1 className="text-4xl font-bold tracking-tight mb-4">
                        Simple, Transparent Pricing
                    </h1>
                    <p className="text-lg text-fd-muted-foreground max-w-2xl mx-auto">
                        Start with self-hosted for free. Need managed infrastructure? Choose a cloud plan.
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-3 gap-8 mb-20">
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative rounded-xl border p-8 ${plan.highlighted
                                ? 'border-fd-primary bg-fd-primary/5 shadow-lg'
                                : 'border-fd-border bg-fd-card'
                                }`}
                        >
                            {plan.highlighted && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <span className="bg-fd-primary text-fd-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                                        Most Popular
                                    </span>
                                </div>
                            )}
                            <div className="mb-6">
                                <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                                <p className="text-sm text-fd-muted-foreground">{plan.description}</p>
                            </div>
                            <div className="mb-6">
                                <span className="text-4xl font-bold">{plan.price}</span>
                                {plan.period && (
                                    <span className="text-fd-muted-foreground">{plan.period}</span>
                                )}
                            </div>
                            <ul className="space-y-3 mb-8">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2 text-sm">
                                        <svg className="w-5 h-5 text-fd-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                            <Link
                                href={plan.ctaLink}
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

                {/* Overage Pricing */}
                <div className="mb-20">
                    <h2 className="text-2xl font-bold text-center mb-8">Overage Pricing</h2>
                    <p className="text-center text-fd-muted-foreground mb-8 max-w-2xl mx-auto">
                        Only pay for what you use beyond your included quota. No surprises.
                    </p>
                    <div className="max-w-2xl mx-auto">
                        <div className="rounded-lg border overflow-hidden">
                            <table className="w-full">
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
                    <div className="overflow-x-auto">
                        <div className="rounded-lg border overflow-hidden min-w-[600px]">
                            <table className="w-full">
                                <thead className="bg-fd-muted">
                                    <tr>
                                        <th className="text-left px-6 py-3 text-sm font-medium">Feature</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Self-Hosted</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Plus</th>
                                        <th className="text-center px-6 py-3 text-sm font-medium">Pro</th>
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
                                                    <td className="px-6 py-3 text-sm pl-10">{item.name}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{item.selfHosted}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{item.plus}</td>
                                                    <td className="px-6 py-3 text-sm text-center">{item.pro}</td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
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
            </main>
        </div>
    );
}
