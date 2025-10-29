import { Metadata } from "next/types";

// Generate metadata with the job ID
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Edit Job | Supercheck`,
    description: `Edit configuration for job`,
  };
}

export default function EditJobIdLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
