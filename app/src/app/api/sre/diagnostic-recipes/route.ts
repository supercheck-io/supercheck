import { NextResponse } from "next/server";

import {
  getSreDiagnosticQueries,
  getSreDiagnosticQuerySetupOptions,
} from "@/actions/sre-diagnostic-queries";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_connector", action: "configure" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  const [queriesResult, setupOptionsResult] = await Promise.all([
    getSreDiagnosticQueries(),
    getSreDiagnosticQuerySetupOptions(),
  ]);

  const success = queriesResult.success && setupOptionsResult.success;
  const error = queriesResult.success
    ? setupOptionsResult.success
      ? null
      : setupOptionsResult.error
    : queriesResult.error;

  return NextResponse.json(
    {
      success,
      error,
      queries: queriesResult.queries,
      setupOptions: setupOptionsResult.options,
    },
    { status: success ? 200 : 403 }
  );
}
