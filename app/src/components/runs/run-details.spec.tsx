import { render, screen } from "@testing-library/react";
import { RunDetails } from "./run-details";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-locations", () => ({ useLocationMetadata: () => ({ locations: [] }) }));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));
jest.mock("@/components/nav-user", () => ({ NavUser: () => null }));
jest.mock("@/components/playground/performance-test-report", () => ({ PerformanceTestReport: () => null }));
jest.mock("./run-status-listener", () => ({ RunStatusListener: () => null }));
jest.mock("./ai-job-analyze-button", () => ({ AIJobAnalyzeButton: () => <button>AI Analyze</button> }));

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { userRole: "org_owner" } }) });
});
afterAll(() => { global.fetch = originalFetch; });

it("shows queued standalone status and keeps job-only AI analysis unavailable", async () => {
  render(<RunDetails run={{ id: "standalone", jobId: null, jobName: "Standalone test", status: "queued", startedAt: "2026-01-01T00:00:00Z" }} />);
  await screen.findByRole("button", { name: "Delete" });
  expect(screen.getByText("Queued")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "AI Analyze" })).not.toBeInTheDocument();
});
it("preserves AI analysis for a job-backed run", async () => {
  render(<RunDetails run={{ id: "job-run", jobId: "job", jobName: "Job", status: "passed", startedAt: "2026-01-01T00:00:00Z" }} />);
  expect(await screen.findByRole("button", { name: "AI Analyze" })).toBeInTheDocument();
});
