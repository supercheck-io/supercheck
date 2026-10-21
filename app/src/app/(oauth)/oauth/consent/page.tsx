import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { auth } from "@/utils/auth";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { MCP_READ_SCOPE, isMcpServerEnabled } from "@/lib/mcp/config";
import { mcpAuthApi } from "@/lib/mcp/auth-api";
import { listConnectableProjects } from "@/lib/mcp/connect-project";
import { verifiedHostForClientId } from "@/lib/mcp/connections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { McpConsent, type McpConsentProject } from "./mcp-consent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect an app | Supercheck",
  robots: { index: false, follow: false },
  // The signed authorization request is in the URL; never leak it through the Referer header.
  referrer: "no-referrer",
};

function Shell({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <Card className="w-full max-w-md shadow-sm">
      <CardHeader className="items-center space-y-3 text-center">
        <CheckIcon className="size-12" aria-hidden="true" />
        <CardTitle className="text-2xl font-bold">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent className="space-y-4">{children}</CardContent> : null}
    </Card>
  );
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/**
 * Client-supplied names are shown to the user, so drop invisible control and
 * formatting characters (zero-width and bidirectional overrides) that could make
 * one app's name read as another's.
 */
function displayName(value: string, max: number): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isMcpServerEnabled()) {
    return (
      <Shell
        title="Connecting apps is not enabled"
        description="This server does not accept connections from MCP clients."
      />
    );
  }

  // Rebuild the signed query exactly as Better Auth issued it. Verification canonicalises
  // (sorts) the parameters, so key order does not matter, but repeated keys must survive.
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item);
    }
  }
  const oauthQuery = query.toString();

  const { secret } = await auth.$context;
  if (!oauthQuery || !(await verifyOAuthQueryParams(oauthQuery, secret))) {
    return (
      <Shell
        title="This link is no longer valid"
        description="Go back to the app you were connecting and start the connection again."
      />
    );
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    // The sign-in page replays this request against the authorize endpoint once signed in.
    redirect(`/sign-in?${oauthQuery}`);
  }

  if (await isImpersonatedSession()) {
    return (
      <Shell
        title="Connecting apps is unavailable while impersonating"
        description="Stop impersonating, then connect the app from your own account."
      />
    );
  }

  const clientId = query.get("client_id");
  const client = clientId
    ? await mcpAuthApi()
        .getOAuthClientPublic({ headers: requestHeaders, query: { client_id: clientId } })
        .catch(() => null)
    : null;
  if (!clientId || !client) {
    return (
      <Shell
        title="Unknown application"
        description="This application is not registered. Go back to it and start the connection again."
      />
    );
  }

  const requested = (query.get("scope") ?? "").split(/\s+/).filter(Boolean);
  if (!requested.includes(MCP_READ_SCOPE)) {
    return (
      <Shell
        title="Nothing to approve"
        description="This request does not ask for access to your Supercheck data."
      />
    );
  }

  const projects = await listConnectableProjects(session.user.id);
  if (!projects.length) {
    return (
      <Shell
        title="No project to connect"
        description="You need access to at least one active project before an app can read it."
      />
    );
  }

  const options: McpConsentProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    organizationName: project.organizationName ?? "",
    isDefault: project.isDefault,
  }));

  return (
    <McpConsent
      oauthQuery={oauthQuery}
      userEmail={session.user.email}
      projects={options}
      client={{
        name: displayName(client.client_name ?? "", 80) || "An application",
        verifiedHost: verifiedHostForClientId(clientId),
        // A host such as raw.githubusercontent.com says little on its own; show the whole identifier.
        clientIdUrl: verifiedHostForClientId(clientId) ? clientId : null,
        redirectHost: hostOf(query.get("redirect_uri")) ?? query.get("redirect_uri")?.split(":")[0] ?? null,
      }}
    />
  );
}
