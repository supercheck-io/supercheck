import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function CopilotLoading() {
  return (
    <div data-fit-viewport className="flex min-h-0 flex-1 items-center justify-center">
      <SupercheckLoading size="md" message="Loading Copilot..." />
    </div>
  );
}
