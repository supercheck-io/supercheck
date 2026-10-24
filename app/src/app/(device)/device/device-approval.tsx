"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { signOut } from "@/utils/auth-client";
import { cn } from "@/lib/utils";

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
  impersonation_not_allowed: "CLI keys cannot be created while impersonating a user. Stop impersonating, then try again.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  authentication_required: "Your session expired. Reload the page to sign in again.",
};

const CODE_LENGTH = 8;

/**
 * A person often pastes the full verification URL, `?code=...`, or a code with
 * spaces and dashes. Accept all of those and keep only the eight code characters.
 */
function normalizeConfirmation(value: string): string {
  const fromUrl = value.match(/[?&]code=([a-z0-9-]+)/i) ?? value.match(/^\s*code\s*=\s*([a-z0-9-]+)/i);
  const raw = fromUrl ? fromUrl[1] : value;
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

function formatConfirmation(value: string): string {
  return value.length > 4 ? `${value.slice(0, 4)}-${value.slice(4)}` : value;
}

export function DeviceApproval({ userCode, userEmail, projects, client }: Props) {
  const [projectId, setProjectId] = useState(
    (projects.find((p) => p.isDefault) ?? projects[0]).id,
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState("");
  const [billingState, setBillingState] = useState<"idle" | "opening" | "opened" | "blocked" | "failed">("idle");
  const [switchingAccount, setSwitchingAccount] = useState(false);
  // The code arrives pre-filled in the URL, so a hurried click could approve a stranger's request.
  // Require the person to retype what their terminal shows.
  const expectedCode = userCode.replace(/[^A-Z0-9]/g, "");
  const codeMatches = typedCode.length === CODE_LENGTH && typedCode === expectedCode;
  const codeIncomplete = typedCode.length > 0 && typedCode.length < CODE_LENGTH;

  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const needsPlan = selected.plan?.active === false;

  const confirmStatus = codeMatches
    ? "Code matches."
    : typedCode.length === 0
      ? "Enter the code to enable Approve."
      : codeIncomplete
        ? `${CODE_LENGTH - typedCode.length} more character${CODE_LENGTH - typedCode.length === 1 ? "" : "s"}.`
        : "That code doesn’t match the one shown above.";

  // Opens the existing checkout in a new tab so this request (and its 15-minute code) stays intact. Checkout charges
  // the session's *active* organization, so make the selected project's organization active first; otherwise a person
  // with several organizations could pay for the wrong one.
  async function openBilling() {
    setBillingState("opening");
    // Open synchronously inside the click handler (browsers block window.open after an await),
    // then navigate once the organization switch has succeeded. Not "noopener": that always returns null.
    const tab = window.open("about:blank", "_blank");
    try {
      const response = await fetch("/api/projects/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selected.id }),
      });
      if (!response.ok) throw new Error("switch failed");
      let opened = false;
      if (tab && !tab.closed) {
        try {
          tab.opener = null;
          tab.location.href = "/subscribe";
          opened = true;
        } catch {
          // Tab closed or navigation refused after a successful switch: offer the fallback link instead.
        }
      }
      setBillingState(opened ? "opened" : "blocked");
    } catch {
      tab?.close();
      setBillingState("failed");
    }
  }

  async function switchAccount() {
    setSwitchingAccount(true);
    setError(null);
    try {
      const result = await signOut();
      if (result?.error) throw new Error("sign out failed");
      // Keep the pending code so the next person can approve the same CLI request.
      window.location.replace(new URL(`/device?code=${encodeURIComponent(userCode)}`, window.location.origin).toString());
    } catch {
      setError("Could not sign out. Reload the page and try again.");
      setSwitchingAccount(false);
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
      <div role="status" className="space-y-3 py-4 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">You&apos;re connected.</p>
          <p className="text-sm text-muted-foreground">
            Return to your terminal; the CLI will finish signing in automatically. You can close this tab.
          </p>
        </div>
      </div>
    );
  }
  if (phase === "denied") {
    return (
      <div role="status" className="space-y-3 py-4 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <X className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Request denied.</p>
          <p className="text-sm text-muted-foreground">No access was granted. You can close this tab.</p>
        </div>
      </div>
    );
  }

  const busy = phase === "submitting" || switchingAccount;
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (codeMatches && !busy) void decide("approve");
      }}
    >
      <div className="rounded-xl border bg-muted/30 px-4 py-5 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Code from your terminal</p>
        <p
          className="mt-2 select-all font-mono text-3xl font-semibold tracking-[0.18em]"
          aria-label="Device code"
        >
          {userCode}
        </p>
      </div>

      <div className="space-y-2.5 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <span className="text-muted-foreground">Signed in as</span>
          <span className="min-w-0 break-all font-medium sm:truncate sm:text-right" title={userEmail}>{userEmail}</span>
        </div>
        {client.hostname || client.version ? (
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <span className="text-muted-foreground">Requested by</span>
            <span className="min-w-0 break-all sm:truncate sm:text-right">
              {client.hostname ?? "Unknown device"}
              {client.version ? ` · CLI ${client.version}` : ""}
            </span>
          </div>
        ) : null}
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
        Device details are self-reported and not verified.
      </p>
      <button
        type="button"
        onClick={() => void switchAccount()}
        disabled={busy || billingState === "opening"}
        className="-mt-2 w-fit text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground disabled:opacity-50"
      >
        {switchingAccount ? "Signing out…" : "Use a different account"}
      </button>

      <fieldset className="space-y-2.5" disabled={busy || billingState === "opening"}>
        <legend className="text-sm font-medium">Project the CLI can access</legend>
        <RadioGroup
          value={projectId}
          onValueChange={(next) => {
            // A billing message belongs to the project it was shown for; never carry it to another organization.
            setProjectId(next);
            setBillingState("idle");
          }}
          className="grid gap-2"
        >
          {projects.map((project) => {
            const selectedProject = projectId === project.id;
            return (
              <Label
                key={project.id}
                htmlFor={`project-${project.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  selectedProject ? "border-primary/60 bg-primary/[0.04]" : "hover:bg-muted/40",
                )}
              >
                <RadioGroupItem value={project.id} id={`project-${project.id}`} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{project.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{project.organizationName}</span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="confirm-code" className="text-sm font-medium">
          Confirm the code
        </Label>
        <Input
          id="confirm-code"
          value={formatConfirmation(typedCode)}
          onChange={(event) => setTypedCode(normalizeConfirmation(event.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          spellCheck={false}
          maxLength={64}
          placeholder="XXXX-XXXX"
          className="font-mono text-base tracking-[0.18em] uppercase"
          aria-describedby="confirm-code-status"
          aria-invalid={typedCode.length > 0 && !codeMatches}
          disabled={busy}
        />
        <p
          id="confirm-code-status"
          aria-live="polite"
          className={cn(
            "text-xs",
            codeMatches
              ? "text-emerald-600 dark:text-emerald-400"
              : typedCode.length > 0
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {confirmStatus}
        </p>
      </div>

      {needsPlan ? (
        <div role="note" className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">{selected.organizationName} has no active plan</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            You can connect the CLI now and run tests locally. Cloud deploys and runs need a plan; approving does not
            depend on it.
          </p>
          {selected.plan?.canPurchase ? (
            <div className="space-y-1.5">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                onClick={openBilling}
                disabled={busy || billingState === "opening"}
              >
                {billingState === "opening" ? "Opening…" : "Choose a plan"}
              </Button>
              {billingState === "opened" ? (
                <p className="text-xs text-muted-foreground">
                  Billing opened in a new tab for {selected.organizationName}. Finish there; this page stays ready.
                  Afterwards run <code className="font-mono">supercheck plan</code> to confirm.
                </p>
              ) : null}
              {billingState === "blocked" ? (
                <p className="text-xs text-muted-foreground">
                  Your browser blocked the new tab.{" "}
                  <a className="underline underline-offset-2" href="/subscribe" target="_blank" rel="noopener noreferrer">
                    Open billing
                  </a>
                  .
                </p>
              ) : null}
              {billingState === "failed" ? (
                <p role="alert" className="text-xs text-destructive">
                  Could not open billing. Try again, or open it from the dashboard.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only an organization owner can choose a plan for {selected.organizationName}.
            </p>
          )}
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        This creates a 90-day CLI key for the selected project. It can do what your role allows in this project and can
        be revoked under CLI tokens.
      </p>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={busy || !codeMatches}>
          {busy ? "Working…" : "Approve"}
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => void decide("deny")}>
          Deny
        </Button>
      </div>
    </form>
  );
}
