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
    // A page that fits the window (data-fit-viewport) or fills it (data-fit-fill) stretches to the full height of <main>.
    // data-fit-fill here too, so a list's fitted page size does not count the stretched space as taken.
    <div
      data-fit-fill
      className="has-[[data-fit-viewport]]:flex has-[[data-fit-viewport]]:min-h-0 has-[[data-fit-viewport]]:flex-1 has-[[data-fit-viewport]]:flex-col has-[[data-fit-fill]]:flex has-[[data-fit-fill]]:flex-1 has-[[data-fit-fill]]:flex-col"
    >
      <PageBreadcrumbs items={breadcrumbs} />
      {children}
    </div>
  );
} 