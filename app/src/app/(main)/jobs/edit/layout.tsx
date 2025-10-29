import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Supercheck | Edit Job",
  description: "Edit an existing test job",
};

export default function EditJobLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
