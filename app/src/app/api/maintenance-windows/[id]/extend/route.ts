import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSreApiPermissions, requireSreSameOriginRequest } from "../../../sre/_auth";
import { extendMaintenanceWindow } from "@/lib/maintenance/windows";
import { clientSource, readJson, windowResponse } from "../../respond";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "update" }]);
  if (!auth.success) return auth.response;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid maintenance window ID" }, { status: 400 });
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return windowResponse(auth.context.organizationId, await extendMaintenanceWindow(auth.context, id.data, read.body as never, clientSource(request)));
}
