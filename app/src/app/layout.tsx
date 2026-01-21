import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SupportChat } from "@/components/support/support-chat";

// Use system fonts instead of Google Fonts for offline builds
const systemFonts = {
  sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
  mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
};

export const metadata: Metadata = {
  title: "Dashboard | Supercheck",
  description: "Automate and Monitor your applications",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
        style={{
          fontFamily: systemFonts.sans.join(", "),
          "--font-geist-sans": systemFonts.sans.join(", "),
          "--font-geist-mono": systemFonts.mono.join(", "),
        } as React.CSSProperties}
        suppressHydrationWarning
      >
        {/* PERFORMANCE: Register service worker for static asset caching */}
        <ServiceWorkerRegistration />
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
