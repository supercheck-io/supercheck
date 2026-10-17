import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: { absolute: 'Pricing | Supercheck' },
    description: 'Supercheck Cloud is coming soon. Preview plans, included usage, and overage rates. Monitoring from EU, US and Singapore. Signups are not open yet.',
    alternates: { canonical: '/pricing' },
    openGraph: {
        title: 'Pricing | Supercheck',
        description: 'Supercheck Cloud is coming soon. Preview plans, included usage, overage rates, and monitoring from EU, US and Singapore.',
        url: '/pricing',
        siteName: 'Supercheck',
        type: 'website',
        images: ['/screenshots/playground-editor.png'],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Pricing | Supercheck',
        description: 'Supercheck Cloud is coming soon. Preview plans, included usage, overage rates, and monitoring from EU, US and Singapore.',
        images: ['/screenshots/playground-editor.png'],
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
