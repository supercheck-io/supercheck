"use client";

import { ServiceDetailView } from "@/components/sre/services/service-detail-view";
import { PageErrorState } from "@/components/shared/page-error-state";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { useSreServiceDetail } from "@/hooks/use-sre";

export function ServiceDetailPageClient({ serviceId }: { serviceId: string }) {
  const query = useSreServiceDetail(serviceId);

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading className="min-h-64 flex-1" message="Loading service..." />
      );
    }

    return (
      <Unavailable
        message={query.error instanceof Error ? query.error.message : "Failed to load service"}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  return query.data.success ? (
    <ServiceDetailView initialDetail={query.data.detail} />
  ) : (
    <Unavailable message={query.data.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
  );
}

function Unavailable({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <PageErrorState noun="service" message={message} backHref="/services" backLabel="Back to services" onRetry={onRetry} retrying={retrying} />
  );
}
