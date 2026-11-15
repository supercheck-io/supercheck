import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSreApiPermissions, requireSreSameOriginRequest } from "../../sre/_auth";
import { deleteMaintenanceWindow, getMaintenanceWindow, updateMaintenanceWindow } from "@/lib/maintenance/windows";
import { clientSource, readJson, windowResponse } from "../respond";

type Params = { params: Promise<{ id: string }> };
const windowId = async ({ params }: Params) => z.string().uuid().safeParse((await params).id);
const invalidId = () => NextResponse.json({ error: "Invalid maintenance window ID" }, { status: 400 });

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "view" }]);
  if (!auth.success) return auth.response;
  const id = await windowId(context);
  if (!id.success) return invalidId();
  return windowResponse(auth.context.organizationId, await getMaintenanceWindow(auth.context, id.data));
}

export async function PATCH(request: NextRequest, context: Params) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "update" }]);
  if (!auth.success) return auth.response;
  const id = await windowId(context);
  if (!id.success) return invalidId();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return windowResponse(auth.context.organizationId, await updateMaintenanceWindow(auth.context, id.data, read.body as never, clientSource(request)));
}

export async function DELETE(request: NextRequest, context: Params) {
  const originError = requireSreSameOriginRequest(request);
  if (originError) return originError;
  const auth = await requireSreApiPermissions([{ resource: "monitor", action: "delete" }]);
  if (!auth.success) return auth.response;
  const id = await windowId(context);
  if (!id.success) return invalidId();
  return windowResponse(auth.context.organizationId, await deleteMaintenanceWindow(auth.context, id.data, clientSource(request)));
}
