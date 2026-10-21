/** @jest-environment node */
import { GET } from "./route";
const mockFindRun = jest.fn();
let mockListener: (event: Record<string, unknown>) => Promise<void>;
jest.mock("@/lib/auth-context", () => ({ requireAuthContext: async () => ({ project: { id: "project" }, organizationId: "org" }) }));
jest.mock("@/utils/db", () => ({ db: {
  select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ runProjectId: "project", jobId: null }] }) }) }) }),
  query: { runs: { findFirst: (...args: unknown[]) => mockFindRun(...args) } },
} }));
jest.mock("@/lib/queue-event-hub", () => ({ getQueueEventHub: () => ({ ready: async () => {}, subscribe: (listener: typeof mockListener) => { mockListener = listener; return () => {}; } }) }));

it.each(["test", "job"])("streams %s events only for the authorized run", async (category) => {
  mockFindRun.mockReset().mockResolvedValue({ id: "run", status: "queued" });
  const controller = new AbortController();
  const response = await GET(new Request("http://localhost/api/job-status/events/run", { signal: controller.signal }));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    await reader.read(); // Connected marker.
    expect(decoder.decode((await reader.read()).value)).toContain('"status":"queued"');
    await mockListener({ category: "monitor", status: "passed", queueJobId: "run" });
    await mockListener({ category, status: "passed", queueJobId: "foreign-run" });
    expect(mockFindRun).toHaveBeenCalledTimes(1);
    mockFindRun.mockResolvedValue({ id: "run", status: "passed" });
    await mockListener({ category, status: "passed", queueJobId: "run" });
    expect(mockFindRun).toHaveBeenCalledTimes(2);
    expect(decoder.decode((await reader.read()).value)).toContain('"status":"passed"');
  } finally {
    controller.abort();
    await reader.cancel();
  }
});
