"use client";

import { ServiceDetailView } from "@/components/sre/services/service-detail-view";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useSreServiceDetail } from "@/hooks/use-sre";

export function ServiceDetailPageClient({ serviceId }: { serviceId: string }) {
  const query = useSreServiceDetail(serviceId);

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading className="h-full" message="Loading service..." />
      );
    }

    return (
      <Unavailable
        message={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load service"
        }
      />
    );
  }

  return query.data.success ? (
    <ServiceDetailView initialDetail={query.data.detail} />
  ) : (
    <Unavailable message={query.data.error} />
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Service unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
