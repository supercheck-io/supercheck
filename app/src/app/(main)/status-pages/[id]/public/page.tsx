import { PublicStatusPage } from "@/components/status-pages/public-status-page";
import { getStatusPage } from "@/actions/get-status-page";
import { getComponents } from "@/actions/get-components";
import { getIncidents } from "@/actions/get-incidents";
import { redirect } from "next/navigation";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";

type PublicStatusPagePageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PublicStatusPagePage({
  params,
}: PublicStatusPagePageProps) {
  const resolvedParams = await params;
  const result = await getStatusPage(resolvedParams.id);

  if (!result.success || !result.statusPage) {
    redirect("/status-pages");
  }

  // Fetch components and incidents for the status page
  const componentsResult = await getComponents(resolvedParams.id);
  const incidentsResult = await getIncidents(resolvedParams.id);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Status Pages", href: "/status-pages" },
    { label: result.statusPage.name, isCurrentPage: true },
  ];

  return (
    <>
      <PageBreadcrumbs items={breadcrumbs} />
      <PublicStatusPage
        statusPage={result.statusPage}
        components={componentsResult.components}
        incidents={incidentsResult.incidents}
        idOrSubdomain={resolvedParams.id}
        isPublicView={false}
      />
    </>
  );
}
