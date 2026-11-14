import { handleHeartbeatPing } from "@/lib/heartbeat/ping-handler";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; action: string }> };

async function ping(request: Request, { params }: Ctx) {
  const { token, action } = await params;
  if (action !== "start" && action !== "fail") {
    return new Response(request.method === "HEAD" ? null : "Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return handleHeartbeatPing(request, token, action);
}

export { ping as GET, ping as POST, ping as HEAD };
