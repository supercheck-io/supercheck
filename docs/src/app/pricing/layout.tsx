import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: { absolute: 'Pricing | Supercheck' },
    description: 'Supercheck Cloud is coming soon. Preview plans, included usage, and overage rates. Monitoring from Europe, North America and Asia Pacific. Signups are not open yet.',
    alternates: { canonical: '/pricing' },
    openGraph: {
        title: 'Pricing | Supercheck',
        description: 'Supercheck Cloud is coming soon. Preview plans, included usage, overage rates, and monitoring from Europe, North America and Asia Pacific.',
        url: '/pricing',
        siteName: 'Supercheck',
        type: 'website',
        images: ['/screenshots/playground-editor.png'],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Pricing | Supercheck',
        description: 'Supercheck Cloud is coming soon. Preview plans, included usage, overage rates, and monitoring from Europe, North America and Asia Pacific.',
        images: ['/screenshots/playground-editor.png'],
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
