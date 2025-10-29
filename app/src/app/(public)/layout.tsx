import type { Metadata } from "next";
import "../globals.css";

// Use system fonts instead of Google Fonts for offline builds
const systemFonts = {
  sans: [
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
  mono: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Consolas",
    "Liberation Mono",
    "Courier New",
    "monospace",
  ],
};

export const metadata: Metadata = {
  title: "Status Page | Supercheck",
  description: "Public status page for monitoring service availability",
};

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className="antialiased"
      style={
        {
          fontFamily: systemFonts.sans.join(", "),
          "--font-geist-sans": systemFonts.sans.join(", "),
          "--font-geist-mono": systemFonts.mono.join(", "),
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      {children}
    </div>
  );
}
