import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function ServicesLoading() {
  return (
    <div className="flex min-h-[420px] flex-1 items-center justify-center">
      <SupercheckLoading size="md" message="Loading services..." />
    </div>
  );
}
