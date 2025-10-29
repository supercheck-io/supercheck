import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Variables | Supercheck",
  description: "View and manage all variables and secrets",
};

export default function VariablesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
