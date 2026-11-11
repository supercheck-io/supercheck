"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signing in again starts a fresh session on the default organization. The deletion dialog sends the owner through
 * here so the same-origin POST switch (membership-checked, origin-checked) makes their organization active again.
 * The destination is fixed, so a crafted link can only land on the organization page.
 */
function SwitchOrganization() {
  const org = useSearchParams().get("org");
  useEffect(() => {
    const done = () => window.location.replace("/org-admin");
    if (!org || !UUID.test(org)) return done();
    fetch("/api/organizations/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: org }),
    }).catch(() => undefined).finally(done);
  }, [org]);
  return <p className="p-6 text-sm text-muted-foreground" role="status">Returning to your organization...</p>;
}

export default function SwitchOrganizationPage() {
  return <Suspense fallback={null}><SwitchOrganization /></Suspense>;
}
