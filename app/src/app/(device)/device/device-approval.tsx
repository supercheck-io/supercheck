"use client";

import { useState } from "react";
import { Check, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
        : "That code doesn’t match the code in your terminal.";

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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">Account</p>
          <p className="truncate text-sm font-medium" title={userEmail}>{userEmail}</p>
          <button
            type="button"
            aria-label="Use a different account"
            onClick={() => void switchAccount()}
            disabled={busy || billingState === "opening"}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline disabled:opacity-50"
          >
            {switchingAccount ? "Signing out…" : "Switch account"}
          </button>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="About CLI access">
              <Info className="size-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label="About CLI access" className="space-y-3 text-sm">
            <p>Access follows your role in the selected project. The key expires in 90 days and can be revoked in CLI tokens.</p>
            {client.hostname || client.version ? (
              <p className="break-words text-xs text-muted-foreground">
                {client.hostname ?? "Unknown device"}{client.version ? ` · CLI ${client.version}` : ""}. Device details are self-reported and not verified.
              </p>
            ) : null}
            {needsPlan ? (
              <div role="note" className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">{selected.organizationName} has no active plan. You can connect without a plan.</p>
                {selected.plan?.canPurchase ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={openBilling} disabled={busy || billingState === "opening"}>
                      {billingState === "opening" ? "Opening…" : "Choose a plan"}
                    </Button>
                    {billingState === "opened" ? <p className="text-xs text-muted-foreground">Billing opened in a new tab for {selected.organizationName}.</p> : null}
                    {billingState === "blocked" ? <a className="block text-xs underline" href="/subscribe" target="_blank" rel="noopener noreferrer">Open billing</a> : null}
                    {billingState === "failed" ? <p role="alert" className="text-xs text-destructive">Could not open billing. Try again.</p> : null}
                  </>
                ) : <p className="text-xs text-muted-foreground">Only an organization owner can choose a plan.</p>}
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cli-project">Project</Label>
        <Select value={projectId} disabled={busy || billingState === "opening"} onValueChange={(next) => { setProjectId(next); setBillingState("idle"); }}>
          <SelectTrigger id="cli-project" className="h-10 min-w-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                <span className="truncate">{project.organizationName} / {project.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-code">Code from your terminal</Label>
        <Input
          id="confirm-code"
          value={formatConfirmation(typedCode)}
          onChange={(event) => setTypedCode(normalizeConfirmation(event.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={512}
          placeholder="XXXX-XXXX"
          className="h-11 font-mono text-base tracking-widest uppercase"
          aria-describedby="confirm-code-status"
          aria-invalid={typedCode.length === CODE_LENGTH && !codeMatches}
          disabled={busy}
        />
        <p id="confirm-code-status" aria-live="polite" className={cn("min-h-4 text-xs", codeMatches ? "text-muted-foreground" : "text-destructive")}>
          {typedCode.length > 0 ? confirmStatus : " "}
        </p>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void decide("deny")}>Deny</Button>
        <Button type="submit" disabled={!codeMatches || busy}>{phase === "submitting" ? "Connecting…" : "Approve"}</Button>
      </div>
    </form>
  );
}
