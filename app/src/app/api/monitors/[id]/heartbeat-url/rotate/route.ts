import { NextRequest } from "next/server";
import { handleHeartbeatUrl } from "@/lib/heartbeat/url-access";

/** POST /api/monitors/[id]/heartbeat-url/rotate: new ping URL; the old one stops working at once. */
export async function POST(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  return handleHeartbeatUrl(id, request.nextUrl.origin, "rotate");
}
