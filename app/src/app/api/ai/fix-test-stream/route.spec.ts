/** @jest-environment node */
jest.mock("@/lib/ai/ai-security", () => ({ AISecurityService: { validateInputs: jest.fn((body) => body) }, AuthService: { validateUserAccess: jest.fn(), canAccessTestReport: jest.fn(), checkRateLimit: jest.fn() } }));
jest.mock("@/lib/ai/ai-streaming-service", () => ({ AIStreamingService: { generateStreamingResponse: jest.fn() } }));
jest.mock("@/lib/ai/ai-prompts", () => ({ AIPromptBuilder: { buildK6FixPrompt: jest.fn(() => "prompt"), generateGuidanceMessage: jest.fn(() => "Retry after the report is ready") } }));
jest.mock("@/lib/ai/ai-service", () => ({ AIFixService: { generateScriptFix: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));
jest.mock("@/lib/services/usage-tracker", () => ({ usageTracker: { consumeAICredit: jest.fn(), refundAICredit: jest.fn() } }));
jest.mock("@/lib/services/subscription-service", () => ({ subscriptionService: { blockUntilSubscribed: jest.fn(), requireValidPolarCustomer: jest.fn() } }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/utils/db", () => ({ db: { query: { runs: { findFirst: jest.fn() } } } }));
jest.mock("@aws-sdk/client-s3", () => {
  const send = jest.fn(async () => ({}));
  return { S3Client: jest.fn(() => ({ send })), ListObjectsV2Command: jest.fn(), GetObjectCommand: jest.fn((input) => ({ input })), __send: send };
});
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/utils/db";
import { AuthService } from "@/lib/ai/ai-security";
import { AIStreamingService } from "@/lib/ai/ai-streaming-service";
import { getActiveOrganization } from "@/lib/session";
import { usageTracker } from "@/lib/services/usage-tracker";
import { POST } from "./route";
import { POST as fixTest } from "../fix-test/route";

const request = () => new NextRequest("http://localhost/api/ai/fix-test-stream", { method: "POST", body: JSON.stringify({ testId: "saved-test-id", testType: "performance", failedScript: "export default function() {}" }) });
describe("streaming AI Fix artifact access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(AuthService.validateUserAccess).mockResolvedValue({ user: { id: "user", email: "user@example.test", organizationId: "org" } });
    jest.mocked(AuthService.canAccessTestReport).mockResolvedValue(true);
    jest.mocked(getActiveOrganization).mockResolvedValue({ id: "org" } as never);
    jest.mocked(usageTracker.consumeAICredit).mockResolvedValue({ allowed: true } as never);
    jest.mocked(db.query.runs.findFirst).mockResolvedValue({ id: "latest-run-id" } as never);
    jest.mocked(AIStreamingService.generateStreamingResponse).mockResolvedValue({ stream: new ReadableStream({ start: (controller) => controller.close() }), model: "test" });
  });
  it("denies unauthorized reports before consuming credit or loading artifacts", async () => {
    jest.mocked(AuthService.canAccessTestReport).mockResolvedValue(false);
    expect((await POST(request())).status).toBe(404);
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
    expect(db.query.runs.findFirst).not.toHaveBeenCalled();
  });
  it.each([["streaming", POST], ["regular", fixTest]] as const)("does not consume AI credit when the %s fix has no report", async (_name, post) => {
    jest.mocked(db.query.runs.findFirst).mockResolvedValue(undefined);
    const response = await post(new NextRequest("http://localhost/api/ai/fix-test", { method: "POST",
      body: JSON.stringify({ testId: "saved-test-id", testType: "browser", failedScript: "test('example', async () => {})" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "report_not_available" });
    expect(usageTracker.consumeAICredit).not.toHaveBeenCalled();
    expect(AIStreamingService.generateStreamingResponse).not.toHaveBeenCalled();
  });
  it.each([["streaming", POST], ["regular", fixTest]] as const)("reads the %s Playwright report from the newest run's directory, not the test id", async (_name, post) => {
    await post(new NextRequest("http://localhost/api/ai/fix-test", { method: "POST",
      body: JSON.stringify({ testId: "saved-test-id", testType: "browser", failedScript: "test('example', async () => {})" }) }));
    const { __send: send } = jest.requireMock("@aws-sdk/client-s3") as { __send: jest.Mock };
    const { ListObjectsV2Command } = jest.requireMock("@aws-sdk/client-s3") as { ListObjectsV2Command: jest.Mock };
    const keys = [
      ...ListObjectsV2Command.mock.calls.map(([input]) => input.Prefix),
      ...send.mock.calls.map(([command]) => command?.input?.Key).filter(Boolean),
    ];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key: string) => key.startsWith("latest-run-id/report/"))).toBe(true);
  });
  it.each([null, "job-id"])("selects the newest canonical run and worker artifact layout (job=%s)", async (jobId) => {
    // No run has this id as its primary key, so the newest run carrying it as metadata.testId wins.
    jest.mocked(db.query.runs.findFirst).mockResolvedValueOnce(undefined).mockResolvedValue({ id: "latest-run-id", jobId } as never);
    expect((await POST(request())).status).toBe(200);
    const options = jest.mocked(db.query.runs.findFirst).mock.calls[1][0];
    expect(options?.orderBy).toHaveLength(1);
    const ordering = options?.orderBy as import("drizzle-orm").SQL[];
    expect(new PgDialect().sqlToQuery(ordering[0]).sql).toContain('"created_at" desc');
    const { __send: send } = jest.requireMock("@aws-sdk/client-s3") as { __send: jest.Mock };
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: jobId ? process.env.S3_K6_JOB_BUCKET_NAME || "k6-job-artifacts" : process.env.S3_K6_TEST_BUCKET_NAME || "k6-test-artifacts", Key: "latest-run-id/report/console.log" },
      { Bucket: jobId ? process.env.S3_K6_JOB_BUCKET_NAME || "k6-job-artifacts" : process.env.S3_K6_TEST_BUCKET_NAME || "k6-test-artifacts", Key: "latest-run-id/report/summary.json" },
    ]);
  });
});
