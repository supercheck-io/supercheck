import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { db } from "@/utils/db";
import { member, organization } from "@/db/schema";
import { getUserProjects } from "@/lib/session";
import { subscriptionService } from "@/lib/services/subscription-service";
import { canManageAPIKeys } from "@/lib/rbac/client-permissions";
import {
  isDeviceAuthEnabled,
  lookupPendingGrant,
  normalizeUserCode,
  formatUserCode,
} from "@/lib/auth/device-authorization";
import {
  allowDeviceAuthRequest,
  DEVICE_AUTH_LIMITS,
} from "@/lib/auth/device-auth-rate-limit";
import { buildDeviceReturnPath } from "@/lib/auth/safe-next-path";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeviceApproval, type DeviceProjectOption } from "./device-approval";
import { WorkspaceSetup } from "./workspace-setup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Authorize CLI | Supercheck",
  robots: { index: false, follow: false },
  // The user code is in the URL; never leak it through the Referer header.
  referrer: "no-referrer",
};

function Shell({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <Card className="w-full max-w-sm shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
        {description ? <CardDescription className="text-sm leading-relaxed">{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent className="space-y-5">{children}</CardContent> : null}
    </Card>
  );
}

function CodeEntryForm({ error }: { error?: string }) {
  return (
    <Shell
      title="Connect the Supercheck CLI"
      description="Enter the code shown in your terminal after running `supercheck login`."
    >
      {/* Plain GET form: viewing a code never approves anything. */}
      <form method="get" action="/device" className="space-y-3">
        <Input
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="XXXX-XXXX"
          aria-label="Device code"
          className="text-center font-mono text-lg tracking-widest"
        />
        {error ? <p role="alert" className="text-center text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full">Continue</Button>
      </form>
    </Shell>
  );
}

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  if (!isDeviceAuthEnabled()) {
    return (
      <Shell
        title="Browser login is not enabled"
        description="This server does not support browser login for the CLI. Create a token in the dashboard and run `supercheck login --token <token>` instead."
      />
    );
  }

  const params = await searchParams;
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const normalized = rawCode ? normalizeUserCode(rawCode) : null;
  const formatted = normalized ? formatUserCode(normalized) : undefined;

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    // Hard-coded allowlisted destination; the code is revalidated by buildDeviceReturnPath.
    redirect(`/sign-in?next=${encodeURIComponent(buildDeviceReturnPath(formatted))}`);
  }
  const userId = session.user.id;

  if (!rawCode) return <CodeEntryForm />;
  if (!normalized || !formatted) {
    return <CodeEntryForm error="That code is not valid. Check the code in your terminal and try again." />;
  }

  // Bound code guessing: authenticated lookups are rate limited per user (fails closed).
  if (!(await allowDeviceAuthRequest([DEVICE_AUTH_LIMITS.verifyPerUser(userId)]))) {
    return (
      <Shell
        title="Too many attempts"
        description="Wait a few minutes, then run `supercheck login` again to get a new code."
      />
    );
  }

  const grant = await lookupPendingGrant(normalized);
  if (!grant) {
    return (
      <CodeEntryForm error="This code is invalid, expired or already used. Run `supercheck login` again for a new one." />
    );
  }

  const memberships = await db
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId));
  const projectGroups = await Promise.all(
    memberships.map((m) => getUserProjects(userId, m.organizationId)),
  );
  const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
  const orgRows = orgIds.length
    ? await db
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(inArray(organization.id, orgIds))
    : [];
  const orgNames = new Map(orgRows.map((o) => [o.id, o.name]));
  const ownedOrgs = new Set(memberships.filter((m) => m.role?.toLowerCase() === "org_owner").map((m) => m.organizationId));
  // Plan state per organization. Self-hosted installs always report an active plan, so the plan step only
  // appears where billing applies. A failed lookup is "unknown" and shows nothing (the server enforces plans anyway).
  const planByOrg = new Map<string, boolean | null>();
  const eligibleOrgIds = [...new Set(projectGroups.flat().filter((p) => p.role && canManageAPIKeys(p.role)).map((p) => p.organizationId))];
  await Promise.all(
    eligibleOrgIds.map(async (id) => {
      try {
        // Never let a slow billing provider hold up the consent page; unknown shows no notice.
        const access = await Promise.race([
          subscriptionService.getSubscriptionAccessStatus(id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("plan lookup timed out")), 3000)),
        ]);
        planByOrg.set(id, access.isActive);
      } catch {
        planByOrg.set(id, null);
      }
    }),
  );
  const options: DeviceProjectOption[] = projectGroups
    .flat()
    .filter((p) => p.role && canManageAPIKeys(p.role))
    .map((p) => ({
      id: p.id,
      name: p.name,
      organizationName: p.organizationName ?? orgNames.get(p.organizationId) ?? "Organization",
      isDefault: p.isDefault,
      plan: { active: planByOrg.get(p.organizationId) ?? null, canPurchase: ownedOrgs.has(p.organizationId) },
    }));

  if (options.length === 0) {
    return (
      <Shell
        title={memberships.length === 0 ? "Set up your workspace" : "No project available"}
        description={
          memberships.length === 0
            ? "You need a workspace before the CLI can connect. This takes a moment."
            : "You are not allowed to create CLI keys in any project. Ask an organization admin for access, or pick another account."
        }
      >
        {memberships.length === 0 ? <WorkspaceSetup /> : null}
      </Shell>
    );
  }

  return (
    <Shell
      title="Connect the CLI"
      description="Only approve a request you started."
    >
      <DeviceApproval
        userCode={formatted}
        userEmail={session.user.email}
        projects={options}
        client={{
          name: grant.clientName,
          version: grant.cliVersion,
          hostname: grant.hostname,
          requestIp: grant.requestIp,
        }}
      />
    </Shell>
  );
}
