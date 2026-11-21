import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "Status Page | Supercheck",
  description: "Public status page for monitoring service availability",
  robots: { index: true, follow: true },
};

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className="font-sans antialiased"
      suppressHydrationWarning
    >
      {children}
    </div>
  );
}
