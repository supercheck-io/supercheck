import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Runs | Supercheck",
  description: "View all Job execution runs",
};

export default function RunsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
