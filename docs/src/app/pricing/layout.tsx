import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Pricing | Supercheck',
    description: 'Simple, transparent pricing for Supercheck. Start with self-hosted for free or choose a cloud plan.',
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return children;
}
