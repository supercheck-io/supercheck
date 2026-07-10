import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

export default function CopilotLoading() {
  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] items-center justify-center">
      <SuperCheckLoading size="md" message="Loading Copilot..." />
    </div>
  );
}
