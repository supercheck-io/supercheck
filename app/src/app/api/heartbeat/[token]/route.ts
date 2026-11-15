import { handleHeartbeatPing } from "@/lib/heartbeat/ping-handler";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function ping(request: Request, { params }: Ctx) {
  const { token } = await params;
  return handleHeartbeatPing(request, token, "ping");
}

export { ping as GET, ping as POST, ping as HEAD };
