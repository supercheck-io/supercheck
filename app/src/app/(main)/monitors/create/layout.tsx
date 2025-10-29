import { Metadata } from "next";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

export const metadata: Metadata = {
  title: "Create Monitor | Supercheck",
  description: "Create a new uptime monitor",
};

interface CreateMonitorLayoutProps {
  children: React.ReactNode;
}

export default function CreateMonitorLayout({ children }: CreateMonitorLayoutProps) {
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Monitors", href: "/monitors" },
    { label: "Create", isCurrentPage: true },
  ];

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      {children}
    </div>
  );
} 