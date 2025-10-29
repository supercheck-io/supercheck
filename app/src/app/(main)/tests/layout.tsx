import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Tests | Supercheck",
  description: "View and manage all tests",
};

export default function TestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
