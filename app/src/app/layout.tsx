import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { HydrationReady } from "@/components/hydration-ready";
import { SupportChat } from "@/components/support/support-chat";

export const metadata: Metadata = {
  title: "Dashboard | Supercheck",
  description: "Open-source testing, monitoring, and AI SRE — as code",
  // The app has its own dark theme; this stops Dark Reader rewriting SVGs before hydration.
  other: { "darkreader-lock": "true" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body
        className="font-sans antialiased"
        suppressHydrationWarning
      >
        {/* Removes the retired root service worker that broke the trace viewer */}
        <ServiceWorkerRegistration />
        {/* TEST SUPPORT: exposes a hydration flag for the E2E suite */}
        <HydrationReady />
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem={true}
            disableTransitionOnChange
          >
            {children}
            <SupportChat />
            <Toaster position="bottom-right" richColors />
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
