"use server";

import * as service from "@/lib/server-actions/sre-diagnostic-queries";
export type { SreDiagnosticQueryListItem, SreDiagnosticQueryActionResult, SreDiagnosticQuerySetupOptions } from "@/lib/server-actions/sre-diagnostic-queries";

export async function getSreDiagnosticQueries() {
  return service.getSreDiagnosticQueries();
}

export async function getSreDiagnosticQuerySetupOptions() {
  return service.getSreDiagnosticQuerySetupOptions();
}

export async function createSreDiagnosticQuery(input: Parameters<typeof service.createSreDiagnosticQuery>[0]) {
  return service.createSreDiagnosticQuery(input);
}

export async function disableSreDiagnosticQuery(input: Parameters<typeof service.disableSreDiagnosticQuery>[0]) {
  return service.disableSreDiagnosticQuery(input);
}
