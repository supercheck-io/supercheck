import { NextRequest } from "next/server";
import { handleHeartbeatUrl } from "@/lib/heartbeat/url-access";

/** GET /api/monitors/[id]/heartbeat-url: the heartbeat's ping URL (editors and above, audited). */
export async function GET(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  return handleHeartbeatUrl(id, request.nextUrl.origin, "reveal");
}
