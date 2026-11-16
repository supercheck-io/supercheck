"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProjectContext } from "@/hooks/use-project-context";
import { useUserPreferences } from "@/hooks/use-project-setup";
import { SetupSkeleton } from "./setup-page";
import { Welcome } from "./welcome";

/** /setup/welcome: the persona question for invited members. They never see the wizard from here. */
export function WelcomePage() {
  const router = useRouter();
  const prefs = useUserPreferences();
  const { currentProject } = useProjectContext();
  const seen = prefs.data?.seen;

  useEffect(() => {
    if (seen) router.replace("/");
  }, [seen, router]);

  if (prefs.isError) {
    return (
      <Alert variant="error">
        <p className="text-sm font-semibold">Could not load your preferences</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void prefs.refetch()}>
          Retry
        </Button>
      </Alert>
    );
  }
  if (!prefs.data || seen) return <SetupSkeleton />;
  return (
    <Welcome
      mode="member"
      projectName={currentProject?.name ?? ""}
      organizationName={currentProject?.organizationName}
      onDone={() => router.push("/")}
    />
  );
}
