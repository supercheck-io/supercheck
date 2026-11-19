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
    // Only a page that fits the window (data-fit-viewport) stretches to the full height of <main>; a list page keeps its
    // natural height, or the list's fitted page size would count the stretched space as taken.
    <div className="has-[[data-fit-viewport]]:flex has-[[data-fit-viewport]]:min-h-0 has-[[data-fit-viewport]]:flex-1 has-[[data-fit-viewport]]:flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      {children}
    </div>
  );
} 