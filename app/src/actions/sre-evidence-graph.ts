"use server";

import { getSreEvidenceGraph } from "@/lib/sre/evidence-graph-queries";

export async function getSreEvidenceGraphAction() {
  return getSreEvidenceGraph();
}
