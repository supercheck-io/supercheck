import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function InvestigationMapLoading() {
  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] items-center justify-center">
      <SupercheckLoading size="md" message="Loading Investigation Map..." />
    </div>
  );
}
