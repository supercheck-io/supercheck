/** Mirrors computeCoverageStatus in worker requirement-coverage.service.ts; keep both in sync (a spec pins the cases). */
export function computeCoverageStatus(
  linked: number,
  passed: number,
  failed: number
): "covered" | "failing" | "missing" {
  if (linked === 0 || (passed === 0 && failed === 0)) return "missing";
  return failed > 0 ? "failing" : "covered";
}
