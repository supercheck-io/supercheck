import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSreApiPermissions, requireSreSameOriginRequest } from "../sre/_auth";
import { createMaintenanceWindow, listMaintenanceWindows } from "@/lib/maintenance/windows";
import { clientSource, readJson, windowResponse } from "./respond";

const querySchema = z.object({
  state: z.enum(["active", "scheduled", "past"]).optional(),
  monitorId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "view" }]);
  if (!auth.success) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  return windowResponse(auth.context.organizationId, await listMaintenanceWindows(auth.context, parsed.data));
}

export async function POST(request: NextRequest) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "update" }]);
  if (!auth.success) return auth.response;
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return windowResponse(auth.context.organizationId, await createMaintenanceWindow(auth.context, read.body as never, clientSource(request)), 201);
}
