import './global.css';
import { OG_IMAGE } from "../lib/assets";
import { RootProvider } from 'fumadocs-ui/provider/next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import SearchDialogWrapper from '../components/search';
import type { Metadata } from 'next';


export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://supercheck.io'
  ),
  title: {
    default: 'Supercheck Docs',
    template: '%s | Supercheck Docs',
  },
  description: 'Open-source testing, monitoring, and AI SRE — as code',
  openGraph: {
    title: 'Supercheck',
    description: 'Open-source testing, monitoring, and AI SRE — as code',
    url: 'https://supercheck.io',
    siteName: 'Supercheck',
    type: 'website',
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: 'Supercheck - Open-source testing, monitoring, and AI SRE — as code',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Supercheck',
    description: 'Open-source testing, monitoring, and AI SRE — as code',
    images: [OG_IMAGE],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} font-sans`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          search={{ SearchDialog: SearchDialogWrapper }}
          theme={{
            defaultTheme: 'light',
            enableSystem: true,
          }}
        >{children}</RootProvider>
      </body>
    </html>
  );
}
