import { NextResponse } from "next/server";

import {
  getSreDiagnosticQueries,
  getSreDiagnosticQuerySetupOptions,
} from "@/actions/sre-diagnostic-queries";

export async function GET() {
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
