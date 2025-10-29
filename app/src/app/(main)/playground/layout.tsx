import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Playground | Supercheck",
  description: "View and edit test scripts",
};

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
