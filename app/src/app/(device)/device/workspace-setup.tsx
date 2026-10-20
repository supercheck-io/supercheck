"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WorkspaceSetup() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function setup() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/setup-defaults", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        pendingInvitationId?: string;
      };
      if (response.status === 403) {
        setMessage("Verify your email address first, then reload this page.");
      } else if (body.pendingInvitationId) {
        setMessage("You have a pending invitation. Accept it from your email, then reload this page.");
      } else if (response.ok && body.success) {
        router.refresh();
        return;
      } else {
        setMessage("We could not set up your workspace. Please try again.");
      }
    } catch {
      setMessage("Network error. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" onClick={setup} disabled={busy}>
        {busy ? "Setting up…" : "Create my workspace"}
      </Button>
      {message ? <p role="alert" className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
