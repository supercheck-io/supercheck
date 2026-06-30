import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { SreAiConsole } from "@/components/sre/sre-ai-console";
import { getSreStandaloneChatHistories } from "@/actions/sre-ai";

export const dynamic = "force-dynamic";

export default async function SreAiPage() {
  const historyResult = await getSreStandaloneChatHistories();

  return (
    <div className="h-[calc(100svh-3.5rem)] overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="sr-only">
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Investigate", href: "/copilot" },
            { label: "AISRE", isCurrentPage: true },
          ]}
        />
      </div>
      <SreAiConsole
        initialHistories={historyResult.histories}
        loadError={historyResult.success ? null : historyResult.error}
      />
    </div>
  );
}
