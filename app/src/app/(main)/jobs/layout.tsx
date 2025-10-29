import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Jobs | Supercheck",
  description: "Manage test jobs and schedules",
};

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
