import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { db } from "@/utils/db";
import { member } from "@/db/schema";
import { getUserProjects } from "@/lib/session";
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
      </Card>
    </main>
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
        <input
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="XXXX-XXXX"
          aria-label="Device code"
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-lg tracking-widest"
        />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          Continue
        </button>
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
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  const projectGroups = await Promise.all(
    memberships.map((m) => getUserProjects(userId, m.organizationId)),
  );
  const options: DeviceProjectOption[] = projectGroups
    .flat()
    .filter((p) => p.role && canManageAPIKeys(p.role))
    .map((p) => ({
      id: p.id,
      name: p.name,
      organizationName: p.organizationName ?? "Organization",
      isDefault: p.isDefault,
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
      title="Authorize the Supercheck CLI"
      description="Only approve if you just ran `supercheck login` yourself and the code below matches your terminal."
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
