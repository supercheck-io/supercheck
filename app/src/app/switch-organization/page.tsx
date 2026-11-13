"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { reloadProjectContext } from "@/lib/project-navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signing in again starts a fresh session on the default organization. The deletion dialog sends the owner through
 * here so the same-origin POST switch (membership-checked, origin-checked) makes their organization active again.
 * The destination is fixed, so a crafted link can only land on the organization page.
 */
function SwitchOrganization() {
  const org = useSearchParams().get("org");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Like the in-app organization selector: drop the cached data of the previous organization before landing.
  const done = () => reloadProjectContext(clearProjectsCache, "/org-admin");
  useEffect(() => {
    if (!org || !UUID.test(org)) return done();
    fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: org }),
    }).then((res) => (res.ok ? done() : setFailed(true)), () => setFailed(true));
  }, [org, attempt]);
  if (failed) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">Could not switch back to your organization.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}>Retry</Button>
          <Button size="sm" variant="outline" onClick={done}>Continue</Button>
        </div>
      </div>
    );
  }
  return <p className="p-6 text-sm text-muted-foreground" role="status">Returning to your organization...</p>;
}

export default function SwitchOrganizationPage() {
  return <Suspense fallback={null}><SwitchOrganization /></Suspense>;
}
