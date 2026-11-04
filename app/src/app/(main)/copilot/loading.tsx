import { SupercheckLoading } from "@/components/shared/supercheck-loading";

export default function CopilotLoading() {
  return (
    <div data-fit-viewport className="flex min-h-[560px] flex-1 items-center lg:min-h-0 justify-center">
      <SupercheckLoading size="md" message="Loading Copilot..." />
    </div>
  );
}
