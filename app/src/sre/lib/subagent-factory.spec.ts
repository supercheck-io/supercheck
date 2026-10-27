/** @jest-environment node */
jest.mock("@/lib/sre/sre-daily-token-limit", () => ({
  assertSreDailyTokenLimit: jest.fn(),
  recordSreTokenUsage: jest.fn(),
}));
jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  generateText: jest.fn().mockResolvedValue({ text: "finding", finishReason: "stop", usage: { totalTokens: 42 } }),
}));
jest.mock("@/lib/ai/ai-provider", () => ({ getProviderModel: jest.fn(), validateAIConfiguration: jest.fn() }));

import { generateText } from "ai";

import { assertSreDailyTokenLimit, recordSreTokenUsage } from "@/lib/sre/sre-daily-token-limit";
import { createSubagentTool } from "./subagent-factory";

const run = (organizationId?: string) =>
  (createSubagentTool({ description: "d", system: "s", organizationId }).execute as (i: unknown, o: unknown) => Promise<unknown>)(
    { task: "check", context: "" }, { toolCallId: "t", messages: [] },
  );

describe("createSubagentTool daily limit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("checks the limit first and counts the reported usage", async () => {
    await run("org-a");
    expect(assertSreDailyTokenLimit).toHaveBeenCalledWith("org-a");
    expect(recordSreTokenUsage).toHaveBeenCalledWith("org-a", { totalTokens: 42 });
  });

  it("does not call the model when the limit is reached", async () => {
    jest.mocked(assertSreDailyTokenLimit).mockRejectedValueOnce(new Error("limit"));
    await expect(run("org-a")).rejects.toThrow("limit");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("skips accounting without an organization", async () => {
    await run();
    expect(assertSreDailyTokenLimit).not.toHaveBeenCalled();
  });
});
