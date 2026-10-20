"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export interface DeviceProjectOption {
  id: string;
  name: string;
  organizationName: string;
  isDefault: boolean;
  /** Billing state of the project's organization. `active: null` means unknown. */
  plan?: { active: boolean | null; canPurchase: boolean };
}

interface Props {
  userCode: string;
  userEmail: string;
  projects: DeviceProjectOption[];
  client: {
    name: string | null;
    version: string | null;
    hostname: string | null;
    requestIp: string | null;
  };
}

type Phase = "idle" | "submitting" | "approved" | "denied";

const ERROR_COPY: Record<string, string> = {
  invalid_code: "This code is no longer valid. Run `supercheck login` again.",
  not_pending: "This request was already handled. Run `supercheck login` again if you still need to connect.",
  expired: "This code expired. Run `supercheck login` again for a new one.",
  too_many_attempts: "Too many attempts for this code. Run `supercheck login` again.",
  forbidden: "You are not allowed to create CLI keys in that project.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  authentication_required: "Your session expired. Reload the page to sign in again.",
};

export function DeviceApproval({ userCode, userEmail, projects, client }: Props) {
  const [projectId, setProjectId] = useState(
    (projects.find((p) => p.isDefault) ?? projects[0]).id,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState("");
  const [billingState, setBillingState] = useState<"idle" | "opening" | "opened" | "blocked" | "failed">("idle");
  // The code arrives pre-filled in the URL, so a hurried click could approve a stranger's request.
  // Require the person to retype what their terminal shows.
  const codeMatches = typedCode.toUpperCase().replace(/[^A-Z0-9]/g, "") === userCode.replace("-", "");

  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const needsPlan = selected.plan?.active === false;

  // Opens the existing checkout in a new tab so this request (and its 15-minute code) stays intact. Checkout charges
  // the session's *active* organization, so make the selected project's organization active first; otherwise a person
  // with several organizations could pay for the wrong one.
  async function openBilling() {
    setBillingState("opening");
    try {
      const response = await fetch("/api/projects/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selected.id }),
      });
      if (!response.ok) throw new Error("switch failed");
      // Not the "noopener" feature: with it window.open always returns null, which would look like a blocked popup.
      // The page is same-origin; dropping `opener` gives the same isolation while keeping the blocked check meaningful.
      const tab = window.open("/subscribe", "_blank");
      if (tab) {
        try { tab.opener = null; } catch { /* cross-origin restrictions: ignore */ }
      }
      setBillingState(tab ? "opened" : "blocked");
    } catch {
      setBillingState("failed");
    }
  }

  async function decide(kind: "approve" | "deny") {
    setPhase("submitting");
    setError(null);
    try {
      const response = await fetch(`/api/auth/device/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "approve" ? { user_code: userCode, project_id: projectId } : { user_code: userCode },
        ),
      });
      if (response.ok) {
        setPhase(kind === "approve" ? "approved" : "denied");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(ERROR_COPY[body.error ?? ""] ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setPhase("idle");
  }

  if (phase === "approved") {
    return (
      <div role="status" className="space-y-2 text-center">
        <p className="text-lg font-semibold">You&apos;re connected.</p>
        <p className="text-sm text-muted-foreground">
          Return to your terminal; the CLI will finish signing in automatically. You can close this tab.
        </p>
      </div>
    );
  }
  if (phase === "denied") {
    return (
      <div role="status" className="space-y-2 text-center">
        <p className="text-lg font-semibold">Request denied.</p>
        <p className="text-sm text-muted-foreground">No access was granted. You can close this tab.</p>
      </div>
    );
  }

  const busy = phase === "submitting";
  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-muted/40 p-3 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Code</p>
        <p className="font-mono text-2xl tracking-widest" aria-label="Device code">
          {userCode}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Signed in as</dt>
        <dd className="truncate">{userEmail}</dd>
        {client.hostname ? (<><dt className="text-muted-foreground">Device</dt><dd className="truncate">{client.hostname}</dd></>) : null}
        {client.version ? (<><dt className="text-muted-foreground">CLI version</dt><dd className="truncate">{client.version}</dd></>) : null}
        {client.requestIp ? (<><dt className="text-muted-foreground">Requested from</dt><dd className="truncate">{client.requestIp}</dd></>) : null}
      </dl>
      <p className="text-xs text-muted-foreground">
        Device details are reported by the requesting program and are not verified.
      </p>

      <fieldset className="space-y-2" disabled={busy || billingState === "opening"}>
        <legend className="text-sm font-medium">Project the CLI can access</legend>
        <RadioGroup
          value={projectId}
          onValueChange={(next) => {
            // A billing message belongs to the project it was shown for; never carry it to another organization.
            setProjectId(next);
            setBillingState("idle");
          }}
          className="space-y-1"
        >
          {projects.map((project) => (
            <div key={project.id} className="flex items-center gap-2 rounded-md border p-2">
              <RadioGroupItem value={project.id} id={`project-${project.id}`} />
              <Label htmlFor={`project-${project.id}`} className="flex-1 cursor-pointer">
                <span className="font-medium">{project.name}</span>
                <span className="block text-xs text-muted-foreground">{project.organizationName}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="confirm-code" className="text-sm font-medium">
          Type the code shown in your terminal to confirm
        </Label>
        <Input
          id="confirm-code"
          value={typedCode}
          onChange={(e) => setTypedCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="XXXX-XXXX"
          className="font-mono tracking-widest"
          disabled={busy}
        />
      </div>

      {needsPlan ? (
        <div role="note" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">{selected.organizationName} has no active plan</p>
          <p className="text-muted-foreground">
            You can connect the CLI now and run tests locally. Deploying and running tests in the cloud needs a plan.
            Approving does not depend on it.
          </p>
          {selected.plan?.canPurchase ? (
            <div className="space-y-1">
              <Button type="button" variant="outline" size="sm" onClick={openBilling} disabled={busy || billingState === "opening"}>
                {billingState === "opening" ? "Opening…" : "Choose a plan"}
              </Button>
              {billingState === "opened" ? (
                <p className="text-xs text-muted-foreground">
                  Billing opened in a new tab for {selected.organizationName}. Finish there; this page stays ready. Afterwards run
                  {" "}<code>supercheck plan</code> to confirm.
                </p>
              ) : null}
              {billingState === "blocked" ? (
                <p className="text-xs text-muted-foreground">
                  Your browser blocked the new tab.{" "}
                  <a className="underline" href="/subscribe" target="_blank" rel="noopener noreferrer">Open billing</a>.
                </p>
              ) : null}
              {billingState === "failed" ? (
                <p role="alert" className="text-xs text-destructive">Could not open billing. Try again, or open it from the dashboard.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only an organization owner can choose a plan. Ask an owner of {selected.organizationName}.</p>
          )}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Approving creates a CLI key for this project that expires in 90 days. It can do what your role
        allows in this project and can be revoked any time under CLI tokens.
      </p>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button className="flex-1" disabled={busy || !codeMatches} onClick={() => decide("approve")}>
          {busy ? "Working…" : "Approve"}
        </Button>
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide("deny")}>
          Deny
        </Button>
      </div>
    </div>
  );
}
