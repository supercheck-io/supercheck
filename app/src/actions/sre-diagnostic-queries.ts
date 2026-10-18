"use server";

import * as service from "@/lib/server-actions/sre-diagnostic-queries";
export type { SreDiagnosticQueryListItem, SreDiagnosticQueryActionResult, SreDiagnosticQuerySetupOptions } from "@/lib/server-actions/sre-diagnostic-queries";

export async function getSreDiagnosticQueries() {
  return service.getSreDiagnosticQueries();
}

export async function getSreDiagnosticQuerySetupOptions() {
  return service.getSreDiagnosticQuerySetupOptions();
}

export async function createSreDiagnosticQuery(...args: Parameters<typeof service.createSreDiagnosticQuery>) {
  return service.createSreDiagnosticQuery(...args);
}

export async function disableSreDiagnosticQuery(...args: Parameters<typeof service.disableSreDiagnosticQuery>) {
  return service.disableSreDiagnosticQuery(...args);
}
