"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthCallout } from "@/components/auth/auth-shell";

export function WorkspaceSetup() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isFailure, setIsFailure] = useState(true);

  async function setup() {
    setBusy(true);
    setMessage(null);
    setIsFailure(true);
    try {
      const response = await fetch("/api/auth/setup-defaults", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        pendingInvitationId?: string;
      };
      if (response.status === 403) {
        setIsFailure(false);
        setMessage("Verify your email address first, then reload this page.");
      } else if (body.pendingInvitationId) {
        setIsFailure(false);
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
    <div className="flex flex-col gap-4">
      <Button size="lg" className="w-full" onClick={setup} disabled={busy}>
        {busy ? "Setting up…" : "Create my workspace"}
      </Button>
      {message ? <AuthCallout variant={isFailure ? "error" : "info"}>{message}</AuthCallout> : null}
    </div>
  );
}
