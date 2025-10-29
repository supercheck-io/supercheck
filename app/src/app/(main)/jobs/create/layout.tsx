import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Supercheck | Create Job",
  description: "Create a new test job",
};

export default function CreateJobLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
