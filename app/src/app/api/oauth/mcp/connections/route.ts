import { headers } from "next/headers";
import { auth } from "@/utils/auth";
import { guardMcpEnabled, mcpJson } from "@/lib/mcp/http";
import { listMcpConnections } from "@/lib/mcp/connections";

export const dynamic = "force-dynamic";

/** GET /api/oauth/mcp/connections — the signed-in user's agent connections. */
export async function GET() {
  const disabled = guardMcpEnabled();
  if (disabled) return disabled;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return mcpJson({ error: "authentication_required" }, 401);

  const connections = await listMcpConnections(session.user.id);
  return mcpJson({ connections });
}
