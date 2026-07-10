import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreCopilotPageClient } from "@/components/sre/sre-copilot-page-client";

export default function SreAiPage() {
  return (
    <div className="h-[calc(100svh-3.5rem)] overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="sr-only">
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Investigate", href: "/copilot" },
            { label: "Copilot", isCurrentPage: true },
          ]}
        />
      </div>
      <SreCopilotPageClient />
    </div>
  );
}
