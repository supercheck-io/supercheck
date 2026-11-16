"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectContext } from "@/hooks/use-project-context";
import { getProjectSetupQueryKey, updateProjectSetup, useProjectSetup, useUserPreferences } from "@/hooks/use-project-setup";
import { NAV } from "@/lib/nav-areas";
import { useSession } from "@/utils/auth-client";
import { SetupChecklist } from "./setup-checklist";
import { Welcome } from "./welcome";
import { SetupWizard } from "./wizard";

const CREATOR_ROLES = ["org_owner", "org_admin"];

export function SetupSkeleton() {
  return (
    <div className="space-y-4" data-testid="setup-skeleton" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="error" data-testid="setup-error">
      <p className="text-sm font-semibold">Could not load project setup</p>
      <p className="text-sm">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
        Retry
      </Button>
    </Alert>
  );
}

export function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectParam = useSearchParams().get("project");
  const { currentProject, switchProject, loading: projectLoading } = useProjectContext();
  const session = useSession();
  const [switchFailed, setSwitchFailed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState<boolean | null>(null);
  const [welcomed, setWelcomed] = useState(false);

  // The create runner and every route act on the active project, so switch before loading.
  const needsSwitch = Boolean(projectParam && currentProject && currentProject.id !== projectParam);
  useEffect(() => {
    if (!needsSwitch || !projectParam) return;
    void switchProject(projectParam, `/setup?project=${encodeURIComponent(projectParam)}`).then((ok) => !ok && setSwitchFailed(true));
  }, [needsSwitch, projectParam, switchProject]);

  const projectId = needsSwitch ? null : (projectParam ?? currentProject?.id ?? null);
  const setup = useProjectSetup(projectId);
  const prefs = useUserPreferences();

  const isCreator = CREATOR_ROLES.includes(currentProject?.userRole ?? "");
  const unseenMember = prefs.data && !prefs.data.seen && !isCreator;
  useEffect(() => {
    if (unseenMember) router.replace("/setup/welcome");
  }, [unseenMember, router]);

  if (switchFailed) return <ErrorState message="The project could not be opened." onRetry={() => setSwitchFailed(false)} />;
  if (projectLoading || !projectId || setup.isPending || prefs.isPending || unseenMember) {
    if (setup.isError || prefs.isError) {
      return <ErrorState message="Check your connection and try again." onRetry={() => { void setup.refetch(); void prefs.refetch(); }} />;
    }
    return <SetupSkeleton />;
  }
  if (setup.isError || prefs.isError || !setup.data || !prefs.data) {
    return <ErrorState message="Check your connection and try again." onRetry={() => { void setup.refetch(); void prefs.refetch(); }} />;
  }

  const { state, checklist, permissions, projectName } = setup.data;

  if (isCreator && !prefs.data.seen && !welcomed) {
    return <Welcome mode="creator" projectName={projectName} organizationName={currentProject?.organizationName} onDone={() => setWelcomed(true)} />;
  }

  const finished = state.status === "completed" || state.status === "dismissed";
  const autoOpen = permissions.canEdit && !finished && (isCreator || state.status === "in_progress");
  // Latch the auto-open: finishing flips `finished`, which must not unmount the wizard and its one-time ping URLs.
  if (wizardOpen === null && autoOpen) setWizardOpen(true);
  const open = wizardOpen ?? autoOpen;

  if (open && permissions.canEdit) {
    return <SetupWizard response={setup.data} persona={prefs.data.persona} userEmail={session.data?.user?.email} />;
  }

  const write = async (status: "in_progress" | "dismissed") => {
    try {
      const res = await updateProjectSetup(projectId, { expectedUpdatedAt: state.updatedAt, status });
      queryClient.setQueryData(getProjectSetupQueryKey(projectId), res);
      return true;
    } catch {
      void queryClient.invalidateQueries({ queryKey: getProjectSetupQueryKey(projectId) });
      toast.error("Could not update setup. Try again.");
      return false;
    }
  };

  const actions = permissions.canEdit ? (
    finished ? (
      <Button onClick={async () => (await write("in_progress")) && setWizardOpen(true)}>Run setup again</Button>
    ) : (
      <>
        <Button onClick={() => setWizardOpen(true)}>{state.status === "in_progress" ? "Continue" : "Start setup"}</Button>
        <Button variant="ghost" onClick={() => void write("dismissed")}>
          Dismiss
        </Button>
      </>
    )
  ) : null;

  return (
    <div className="space-y-6" data-testid="setup-checklist-view">
      <PageHeader
        title="Project setup"
        description={`${checklist.done} of ${checklist.total} done in ${projectName}`}
        icon={NAV.projectSetup.icon}
        tone={NAV.projectSetup.tone}
        actions={actions}
      />
      {!permissions.canEdit ? <Alert variant="info">You have view access. A project admin can finish setup.</Alert> : null}
      {state.status === "dismissed" ? (
        <Alert variant="info">Getting started was dismissed. The dashboard shows its usual content; Project setup stays in Cmd+K and Organization &gt; Projects.</Alert>
      ) : null}
      <SetupChecklist checklist={checklist} />
    </div>
  );
}
