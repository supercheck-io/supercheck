import { Metadata } from "next";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

export const metadata: Metadata = {
  title: "Monitors | Supercheck",
  description: "List of monitors",
};

interface CreateMonitorLayoutProps {
  children: React.ReactNode;
}

export default function CreateMonitorLayout({ children }: CreateMonitorLayoutProps) {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Monitors", isCurrentPage: true },

  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      {children}
    </div>
  );
} 