import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Create Test | Supercheck",
  description: "Create a new test",
};

export default function CreateTestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
