import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: { absolute: 'Pricing | Supercheck' },
    description: 'Simple, transparent pricing for Supercheck. Start with self-hosted for free or choose a cloud plan.',
    alternates: { canonical: '/pricing' },
    openGraph: {
        title: 'Pricing | Supercheck',
        description: 'Compare monthly cloud plans, included usage, and overage rates, or self-host Supercheck at no license cost.',
        url: '/pricing',
        siteName: 'Supercheck',
        type: 'website',
        images: ['/screenshots/playground-editor.png'],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Pricing | Supercheck',
        description: 'Compare monthly cloud plans, included usage, and overage rates, or self-host Supercheck at no license cost.',
        images: ['/screenshots/playground-editor.png'],
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
