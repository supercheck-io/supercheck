/**
 * Real Better Auth + real PostgreSQL: connect one OAuth client to two projects,
 * disconnect one, and prove the other keeps working.
 *
 * Needs a migrated database in DATABASE_URL. The in-memory check
 * (check-mcp-oauth.ts) cannot cover this because disconnecting runs Drizzle
 * queries against the real tables, and Better Auth's reaction to a replayed
 * token (it wipes every refresh token the client holds for the user) is only
 * observable end to end.
 *
 * Run by src/lib/mcp/oauth-flow.db.spec.ts.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { auth } from "../src/utils/auth";
import { clearProjectSelection, saveProjectSelection } from "../src/lib/mcp/project-selection";
import { listMcpConnections, revokeMcpConnection } from "../src/lib/mcp/connections";

const BASE = process.env.BETTER_AUTH_URL as string;
const RESOURCE = `${BASE}/api/mcp`;
const REDIRECT = "http://127.0.0.1:8765/callback";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

const json = { "content-type": "application/json" };
const form = { "content-type": "application/x-www-form-urlencoded" };
const base64url = (buffer: Buffer) => buffer.toString("base64url");

function send(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const { cookie, ...rest } = init;
  return auth.handler(
    new Request(`${BASE}${path}`, {
      ...rest,
      redirect: "manual",
      headers: { origin: BASE, ...(cookie ? { cookie } : {}), ...(rest.headers as Record<string, string>) },
    }),
  );
}

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 2, onnotice: () => {} });

  // --- a user who belongs to an organization with two projects
  const email = `db-check-${Date.now()}@example.com`;
  const password = "Db-Check-Passw0rd-12345";
  await send("/api/auth/sign-up/email", { method: "POST", headers: json, body: JSON.stringify({ email, password, name: "Check" }) });
  const signIn = await send("/api/auth/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  const userId = session?.user.id as string;
  const sessionId = session?.session.id as string;

  const orgId = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  await sql`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgId}, 'Org', ${`org-${orgId}`}, now())`;
  await sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${randomUUID()}, ${orgId}, ${userId}, 'org_owner', now())`;
  await sql`INSERT INTO projects (id, organization_id, name, slug, is_default, status) VALUES
    (${projectA}, ${orgId}, 'Alpha', ${`a-${projectA}`}, true, 'active'),
    (${projectB}, ${orgId}, 'Beta', ${`b-${projectB}`}, false, 'active')`;

  // --- one public client
  const registered = await send("/api/auth/oauth2/register", {
    method: "POST", headers: json,
    body: JSON.stringify({ client_name: "Agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", scope: "mcp:read offline_access" }),
  });
  const client = (await registered.json()) as { client_id: string };

  // Connect the client to one project: the connect screen's authorize -> choose -> consent -> token.
  async function connect(projectId: string): Promise<{ access: string; refresh: string }> {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const query = new URLSearchParams({
      response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, scope: "mcp:read offline_access",
      state: "s", code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE,
    });
    const authorize = await send(`/api/auth/oauth2/authorize?${query}`, { cookie });
    const consentUrl = new URL(authorize.headers.get("location") ?? "", BASE);
    if (consentUrl.pathname !== "/oauth/consent") throw new Error(`expected the consent screen, got ${consentUrl.pathname}`);

    await saveProjectSelection({ sessionId, userId, projectId });
    const consent = await send("/api/auth/oauth2/consent", {
      method: "POST", cookie, headers: json, body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    });
    // The consent route clears the choice after every decision; do the same.
    await clearProjectSelection({ sessionId, userId, projectId });
    const code = new URL(((await consent.json()) as { url: string }).url).searchParams.get("code") as string;
    const token = await send("/api/auth/oauth2/token", {
      method: "POST", headers: form,
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
    });
    const body = (await token.json()) as { access_token: string; refresh_token: string };
    return { access: body.access_token, refresh: body.refresh_token };
  }
  const refresh = (token: string) =>
    send("/api/auth/oauth2/token", {
      method: "POST", headers: form,
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: client.client_id, resource: RESOURCE }),
    });

  const a = await connect(projectA);
  const b = await connect(projectB);
  check("the client is connected to both projects", (await listMcpConnections(userId)).length === 2);

  // --- disconnect project A
  const connections = await listMcpConnections(userId);
  const connectionA = connections.find((c) => c.projectId === projectA);
  check("each connection names its project", connectionA?.projectName === "Alpha" && connections.some((c) => c.projectName === "Beta"));
  await revokeMcpConnection({ userId, consentId: connectionA?.id as string });

  const afterA = await refresh(a.refresh);
  check("the disconnected project's refresh token no longer works", afterA.status === 400, `${afterA.status}`);

  // Replaying that token is what Better Auth treats as reuse; project B must be unaffected.
  const afterB = await refresh(b.refresh);
  check("the same client's other project still refreshes", afterB.status === 200, `${afterB.status}`);

  const remaining = await listMcpConnections(userId);
  check("only the other project remains listed", remaining.length === 1 && remaining[0].projectId === projectB);
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM oauth_refresh_token WHERE user_id = ${userId} AND reference_id = ${projectB} AND revoked IS NULL
  `;
  check("project B's refresh tokens were not touched", count >= 1, `${count}`);

  // --- consent can only be recorded with a project
  const verifier = base64url(randomBytes(32));
  const query = new URLSearchParams({
    response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, scope: "mcp:read",
    state: "s", code_challenge: base64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", resource: RESOURCE,
  });
  const authorize = await send(`/api/auth/oauth2/authorize?${query}`, { cookie });
  const consentUrl = new URL(authorize.headers.get("location") ?? "", BASE);
  const noProject = await send("/api/auth/oauth2/consent", {
    method: "POST", cookie, headers: json, body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  });
  check("approving without choosing a project is refused", noProject.status === 400, `${noProject.status}`);
  const [{ orphan }] = await sql<{ orphan: number }[]>`
    SELECT count(*)::int AS orphan FROM oauth_consent WHERE user_id = ${userId} AND reference_id IS NULL
  `;
  check("no project-less consent was recorded", orphan === 0, `${orphan}`);

  // --- normal sessions carry no signed user JWT
  const sessionResponse = await send("/api/auth/get-session", { cookie });
  check("get-session does not emit a signed user JWT", sessionResponse.headers.get("set-auth-jwt") === null);

  await sql.end({ timeout: 2 });
}

main().then(
  () => {
    if (failures.length) {
      console.error(`\n${failures.length} check(s) failed:\n - ${failures.join("\n - ")}`);
      process.exit(1);
    }
    console.log("\nMCP OAuth database check passed");
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : error);
    process.exit(1);
  },
);
