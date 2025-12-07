import '@/app/global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Inter } from 'next/font/google';
import SearchDialogWrapper from '@/components/search';
import type { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://supercheck.io'
  ),
  title: {
    default: 'Supercheck',
    template: '%s | Supercheck',
  },
  description: 'Open source AI-powered test automation and monitoring platform',
  openGraph: {
    title: 'Supercheck',
    description: 'Open source AI-powered test automation and monitoring platform',
    url: 'https://supercheck.io',
    siteName: 'Supercheck',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Supercheck',
    description: 'Open source AI-powered test automation and monitoring platform',
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog: SearchDialogWrapper }}>{children}</RootProvider>
      </body>
    </html>
  );
}
