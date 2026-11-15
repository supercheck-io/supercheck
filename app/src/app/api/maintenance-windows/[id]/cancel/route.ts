import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSreApiPermissions, requireSreSameOriginRequest } from "../../../sre/_auth";
import { cancelMaintenanceWindow } from "@/lib/maintenance/windows";
import { clientSource, windowResponse } from "../../respond";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "update" }]);
  if (!auth.success) return auth.response;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid maintenance window ID" }, { status: 400 });
  return windowResponse(auth.context.organizationId, await cancelMaintenanceWindow(auth.context, id.data, clientSource(request)));
}
