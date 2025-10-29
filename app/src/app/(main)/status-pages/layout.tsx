import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Status Pages | Supercheck",
  description: "View and edit status pages",
};

export default function StatusPagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
