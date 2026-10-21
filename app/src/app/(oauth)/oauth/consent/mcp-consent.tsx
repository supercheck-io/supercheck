"use client";

import { useState } from "react";
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
  client: {
    name: string;
    /** Host that controls this client's metadata document; null when it registered itself. */
    verifiedHost: string | null;
    redirectHost: string | null;
  };
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
};

export function McpConsent({ oauthQuery, userEmail, projects, client, navigate = (url) => window.location.assign(url) }: Props) {
  const [projectId, setProjectId] = useState((projects.find((p) => p.isDefault) ?? projects[0]).id);
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

  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardHeader className="items-center space-y-3 text-center">
        <CheckIcon className="size-12" aria-hidden="true" />
        <CardTitle className="text-2xl font-bold">Connect {client.name}</CardTitle>
        <CardDescription>
          {client.verifiedHost ? (
            <>
              Published by <span className="font-medium text-foreground">{client.verifiedHost}</span>
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-500">
              Unverified app: it registered itself, so anyone could have chosen this name. Only continue if you
              just started this connection yourself.
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{client.name} will be able to:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Read tests, runs, monitors and incidents in the project you choose</li>
          </ul>
          <p className="text-muted-foreground">
            It cannot change anything, run tests, or read secrets and variable values. It sees only what you can
            see in that project, and you can disconnect it at any time.
          </p>
        </div>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 text-sm font-medium">Project</legend>
          <RadioGroup value={projectId} onValueChange={setProjectId} className="gap-2">
            {projects.map((project) => (
              <Label
                key={project.id}
                htmlFor={`project-${project.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem id={`project-${project.id}`} value={project.id} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{project.name}</span>
                  {project.organizationName ? (
                    <span className="block truncate text-xs text-muted-foreground">{project.organizationName}</span>
                  ) : null}
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        {client.redirectHost ? (
          <p className="text-xs text-muted-foreground">
            After you approve, you will be sent back to <span className="font-mono">{client.redirectHost}</span>.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-col gap-2">
        <Button className="w-full" disabled={busy} onClick={() => decide(true)}>
          {phase === "idle" ? "Approve" : phase === "submitting" ? "Connecting…" : "Returning to the app…"}
        </Button>
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
        <p className="pt-1 text-center text-xs text-muted-foreground">
          Signed in as {userEmail}. Manage connected apps any time at{" "}
          <a href="/connected-apps" className="underline">/connected-apps</a>.
        </p>
      </CardFooter>
    </Card>
  );
}
