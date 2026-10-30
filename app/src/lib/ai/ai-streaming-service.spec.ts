/** @jest-environment node */
jest.mock("ai", () => ({ streamText: jest.fn() }));
jest.mock("./ai-provider", () => ({ getActualModelName: () => "test-model", getProviderGenerationOptions: () => ({}), getProviderModel: () => ({}), validateAIConfiguration: jest.fn() }));
jest.mock("./ai-rate-limiter", () => ({ aiRateLimiter: { checkAndTrackTokens: jest.fn(async () => ({ allowed: true })), checkRateLimit: jest.fn(async () => ({ allowed: true })) } }));
jest.mock("./ai-code-validator", () => ({ aiCodeValidator: { quickValidate: () => ({ hasIssues: false }) } }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => false }));
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn() }));
import { streamText } from "ai";
import { aiRateLimiter } from "./ai-rate-limiter";
import { AIStreamingService } from "./ai-streaming-service";

describe("AI streaming lifecycle", () => {
  beforeEach(() => jest.clearAllMocks());
  it("aborts the provider when the HTTP request disconnects", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    jest.mocked(streamText).mockReturnValue({ textStream: (async function* () { await gate; yield "late"; })() } as never);
    const request = new AbortController();
    await AIStreamingService.generateStreamingResponse({ prompt: "test", signal: request.signal, orgId: "org" });
    const options = jest.mocked(streamText).mock.calls[0][0];
    request.abort();
    expect(options.abortSignal?.aborted).toBe(true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  it("records the known completed-step usage on provider abort", async () => {
    jest.mocked(streamText).mockImplementation((options) => ({
      textStream: (async function* () {
        await options.onAbort?.({ steps: [{ usage: { totalTokens: 7 } }] } as never);
        throw new Error("provider aborted");
      })(),
    }) as never);
    const { stream } = await AIStreamingService.generateStreamingResponse({ prompt: "test", orgId: "org", tier: "plus" });
    await new Response(stream).text();
    expect(aiRateLimiter.checkAndTrackTokens).toHaveBeenCalledWith("org", 7, "plus");
  });
  it("sends a generic error to the client without the provider message", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(streamText).mockImplementation(() => ({
      textStream: (async function* () { throw new Error("sk-secret upstream 401"); })(),
    }) as never);
    const { stream } = await AIStreamingService.generateStreamingResponse({ prompt: "test", orgId: "org" });
    const text = await new Response(stream).text();
    expect(text).toContain("AI generation failed. Try again.");
    expect(text).not.toContain("sk-secret");
  });
  it("propagates request abort and consumer cancellation to the provider", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    jest.mocked(streamText).mockReturnValue({ textStream: (async function* () { await gate; yield "late"; })() } as never);
    const request = new AbortController();
    const { stream } = await AIStreamingService.generateStreamingResponse({ prompt: "test", signal: request.signal, orgId: "org" });
    const provider = jest.mocked(streamText).mock.calls[0][0];
    expect(provider.abortSignal?.aborted).toBe(false);
    await stream.cancel();
    expect(provider.abortSignal?.aborted).toBe(true);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.abort();
  });
  it("tracks SDK6 usage after completion without double-counting request limits", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    jest.mocked(streamText).mockImplementation((options) => ({
      textStream: (async function* () { yield "generated"; await options.onFinish?.({ totalUsage: usage } as never); })(),
      usage: Promise.resolve(usage),
    }) as never);
    const { stream } = await AIStreamingService.generateStreamingResponse({ prompt: "test", orgId: "org", userId: "user", tier: "plus" });
    const text = await new Response(stream).text();
    expect(text).toContain('"promptTokens":10');
    expect(aiRateLimiter.checkAndTrackTokens).toHaveBeenCalledWith("org", 15, "plus");
    expect(aiRateLimiter.checkRateLimit).not.toHaveBeenCalled();
  });

  describe("onFirstContent billing hook", () => {
    const provider = (chunks: Array<string | Error>) => jest.mocked(streamText).mockImplementation(() => ({
      textStream: (async function* () { for (const c of chunks) { if (c instanceof Error) throw c; yield c; } })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    }) as never);
    const run = async (chunks: Array<string | Error>) => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      provider(chunks);
      const onFirstContent = jest.fn(async () => undefined);
      const { stream } = await AIStreamingService.generateStreamingResponse({ prompt: "t", orgId: "org", onFirstContent });
      await new Response(stream).text();
      return onFirstContent;
    };
    it("charges exactly once when content streams", async () => {
      expect(await run(["a", "b", "c"])).toHaveBeenCalledTimes(1);
    });
    it("does not charge an empty stream", async () => {
      expect(await run(["", ""])).not.toHaveBeenCalled();
    });
    it("does not charge an error before any content", async () => {
      expect(await run([new Error("boom")])).not.toHaveBeenCalled();
    });
    it("does not charge when initialization throws before streaming", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      jest.mocked(streamText).mockImplementation(() => { throw new Error("401 unauthorized"); });
      const onFirstContent = jest.fn();
      await expect(AIStreamingService.generateStreamingResponse({ prompt: "t", orgId: "org", onFirstContent })).rejects.toThrow("AI_AUTH_ERROR");
      expect(onFirstContent).not.toHaveBeenCalled();
    });
    it("still charges when the stream fails after content started", async () => {
      expect(await run(["a", new Error("late")])).toHaveBeenCalledTimes(1);
    });
  });
});
