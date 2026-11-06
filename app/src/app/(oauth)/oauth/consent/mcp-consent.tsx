"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckIcon } from "@/components/logo/supercheck-logo";

export interface McpConsentProject {
  id: string;
  name: string;
  organizationName: string;
  isDefault: boolean;
}

interface Props {
  oauthQuery: string;
  userEmail: string;
  projects: McpConsentProject[];
  /** The app also asked to assign, acknowledge and resolve incidents (mcp:incidents:write). */
  canWriteIncidents?: boolean;
  /** The app also asked to start AI SRE work (mcp:sre). */
  canRunSre?: boolean;
  client: {
    name: string;
    /** Host that controls this client's metadata document; null when it registered itself. */
    verifiedHost: string | null;
    /** The full metadata-document URL behind verifiedHost. */
    clientIdUrl?: string | null;
    redirectHost: string | null;
  };
  /** Projects where the app already holds broader access than this request; approving cannot narrow it. */
  keepsEarlierAccessProjectIds?: string[];
  /** Leaves the page for the client's redirect URI. Replaceable so tests need not navigate. */
  navigate?: (url: string) => void;
}

type Phase = "idle" | "submitting" | "redirecting";

const ERROR_COPY: Record<string, string> = {
  forbidden: "You no longer have access to that project. Pick another one.",
  authentication_required: "Your session expired. Reload the page to sign in again.",
  impersonation_not_allowed: "Apps cannot be connected while impersonating a user.",
  invalid_request: "Something is wrong with this request. Go back to the app and try again.",
  consent_failed: "This request expired or was already used. Go back to the app and start again.",
  project_required: "Choose a project first.",
  consent_scopes_not_restored: "The connection was saved with fewer permissions than before. Disconnect it in Connected apps, then connect again and approve every permission.",
};

export function McpConsent({ oauthQuery, userEmail, projects, canWriteIncidents = false, canRunSre = false, keepsEarlierAccessProjectIds = [], client, navigate = (url) => window.location.assign(url) }: Props) {
  const [projectId, setProjectId] = useState((projects.find((p) => p.isDefault) ?? projects[0]).id);
  const [initialProjectId] = useState(projectId);
  const orderedProjects = [...projects].sort((a, b) => Number(b.id === initialProjectId) - Number(a.id === initialProjectId));
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  async function decide(accept: boolean) {
    setPhase("submitting");
    setError(null);
    try {
      const response = await fetch("/api/oauth/mcp/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: oauthQuery, ...(accept ? { projectId } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(ERROR_COPY[body.error ?? ""] ?? "Something went wrong. Go back to the app and try again.");
        setPhase("idle");
        return;
      }
      setPhase("redirecting");
      navigate(body.url);
    } catch {
      setError("Network error. Check your connection and try again.");
      setPhase("idle");
    }
  }

  // One org for every project: say it once in the legend instead of on each row.
  const sharedOrg =
    projects[0]?.organizationName && projects.every((p) => p.organizationName === projects[0].organizationName)
      ? projects[0].organizationName
      : null;

  return (
    // The project list is the only region that grows; Approve and Deny stay in view.
    <Card className="flex max-h-[calc(100dvh-5.5rem)] sm:max-h-[calc(100dvh-7.5rem)] w-full max-w-md flex-col shadow-sm">
      <CardHeader className="items-center p-4 pb-3 text-center">
        <CheckIcon className="size-8" aria-hidden="true" />
        <CardTitle className="break-words text-xl font-bold">Connect {client.name}</CardTitle>
        {client.verifiedHost ? (
          <CardDescription>
            Metadata hosted at <span className="font-medium text-foreground">{client.verifiedHost}</span>
            {client.clientIdUrl ? (
              <span className="mt-1 block break-all font-mono text-xs">{client.clientIdUrl}</span>
            ) : null}
          </CardDescription>
        ) : null}
      </CardHeader>

      {/* Outside the scroll region so it cannot scroll out of sight above Approve. */}
      <div className="px-4 pb-3 empty:hidden">
        {client.verifiedHost ? null : (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <p>
              <span className="font-medium">Unverified app.</span> It registered itself, so anyone could have chosen
              this name. Only continue if you just started this connection yourself.
            </p>
          </div>
        )}
      </div>

      <CardContent className="min-h-32 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <p className="font-medium">{client.name} will be able to:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>
              Read tests, jobs, runs, monitors, requirements, status pages, services, incidents and investigations
              in the project you choose
            </li>
            <li>See variable names and types, never their values</li>
            {canWriteIncidents ? <li>Assign, acknowledge and resolve incidents, as you</li> : null}
            {canRunSre ? <li>Start AI SRE triage, investigations and evidence briefs, which use AI credits</li> : null}
          </ul>
          <p className="text-xs text-muted-foreground">
            It cannot {canWriteIncidents || canRunSre ? "change anything else, " : "change anything, "}run tests, or read
            secrets and variable values. It can only do what your role allows in that project, and you can
            disconnect it at any time.
          </p>
        </div>

        <fieldset className="min-w-0 space-y-1.5" disabled={busy}>
          <legend className="mb-1 break-words text-sm font-medium">
            Project{sharedOrg ? <span className="font-normal text-muted-foreground"> · {sharedOrg}</span> : null}
          </legend>
          <RadioGroup value={projectId} onValueChange={setProjectId} className="max-h-56 gap-0 divide-y overflow-y-auto rounded-md border">
            {/* The preselected project comes first so it is never scrolled out of view. */}
            {orderedProjects.map((project) => (
              <Label
                key={project.id}
                htmlFor={`project-${project.id}`}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-normal hover:bg-muted/40 has-[[data-state=checked]]:bg-primary/10"
              >
                <RadioGroupItem id={`project-${project.id}`} value={project.id} />
                <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                {!sharedOrg && project.organizationName ? (
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{project.organizationName}</span>
                ) : null}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 px-4 pb-4">
        {keepsEarlierAccessProjectIds.includes(projectId) ? (
          <p className="text-center text-xs text-muted-foreground">
            This app keeps the access you approved earlier. Disconnect it in Connected apps to reduce access.
          </p>
        ) : null}

        {client.redirectHost ? (
          <p className="text-center text-xs text-muted-foreground">
            After you approve, you will be sent back to <span className="font-mono">{client.redirectHost}</span>.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex w-full gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
            {phase === "idle" ? "Approve" : phase === "submitting" ? "Connecting…" : "Redirecting…"}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Signed in as {userEmail}. Manage connected apps any time at{" "}
          <a href="/connected-apps" className="underline">/connected-apps</a>.
        </p>
      </CardFooter>
    </Card>
  );
}
