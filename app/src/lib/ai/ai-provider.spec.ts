/** @jest-environment node */
import { getActualModelName, getProviderModel, getProviderGenerationOptions, validateAIConfiguration } from "./ai-provider";

describe("getProviderGenerationOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.AZURE_INCLUDE_TEMPERATURE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes temperature for legacy OpenAI models", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-4o-mini";

    expect(getProviderGenerationOptions({ temperature: 0.2 })).toEqual({
      temperature: 0.2,
    });
  });

  it("defaults to Luna Responses and omits temperature", () => {
    expect(getActualModelName()).toBe("gpt-6-luna");
    expect(getProviderModel()).toMatchObject({ modelId: "gpt-6-luna", provider: "openai.responses" });
    expect(getProviderGenerationOptions({ temperature: 0.2 })).toEqual({});
  });

  it("preserves explicit model overrides", () => {
    process.env.AI_MODEL = "gpt-4o-mini";
    expect(getActualModelName()).toBe("gpt-4o-mini");
    expect(getProviderModel()).toMatchObject({ modelId: "gpt-4o-mini" });
  });

  it("requires a DeepSeek key without falling back to OpenAI", () => {
    process.env.AI_PROVIDER = "deepseek";
    expect(getActualModelName()).toBe("deepseek-flash");
    expect(() => validateAIConfiguration()).toThrow("DEEPSEEK_API_KEY");
    expect(() => getProviderModel()).toThrow("DEEPSEEK_API_KEY");
    process.env.DEEPSEEK_API_KEY = "   ";
    expect(() => validateAIConfiguration()).toThrow("DEEPSEEK_API_KEY");
  });

  it("selects DeepSeek Chat Completions only when configured", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    expect(() => validateAIConfiguration()).not.toThrow();
    expect(getProviderModel()).toMatchObject({ modelId: "deepseek-flash", provider: "deepseek.chat" });
  });

  it.each(["doGenerate", "doStream"] as const)("sends Luna's compatible %s payload", async (method) => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("captured"));
    try {
      const model = getProviderModel();
      if (typeof model === "string") throw new Error("Expected model adapter");
      await expect(model[method]({
        prompt: [
          { role: "user", content: [{ type: "text", text: "test" }] },
          { role: "assistant", content: [{ type: "text", text: "previous step", providerOptions: { openai: { itemId: "msg_unstored" } } }] },
        ],
        maxOutputTokens: 100,
        tools: [{ type: "function", name: "testTool", inputSchema: { type: "object", properties: {} } }],
      })).rejects.toThrow();
      expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/v1/responses");
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "none" }, store: false, max_output_tokens: 100 });
      expect(body.temperature).toBeUndefined();
      expect(body.tools[0].name).toBe("testTool");
      expect(body.input).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: expect.arrayContaining([
          expect.objectContaining({ type: "output_text", text: "previous step" }),
        ]) }),
      ]));
      expect(body.input.some((item: { type?: string }) => item.type === "item_reference")).toBe(false);
      if (method === "doStream") expect(body.stream).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it.each(["doGenerate", "doStream"] as const)("sends DeepSeek's compatible %s payload", async (method) => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("captured"));
    try {
      const model = getProviderModel();
      if (typeof model === "string") throw new Error("Expected model adapter");
      await expect(model[method]({
        prompt: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        maxOutputTokens: 100,
        tools: [{ type: "function", name: "testTool", inputSchema: { type: "object", properties: {} } }],
      })).rejects.toThrow();
      expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.deepseek.com/chat/completions");
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer test-deepseek-key");
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ model: "deepseek-flash", thinking: { type: "disabled" }, max_tokens: 100 });
      expect(body.tools[0].function.name).toBe("testTool");
      if (method === "doStream") expect(body.stream).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("omits temperature for Azure providers by default", () => {
    process.env.AI_PROVIDER = "azure";

    expect(getProviderGenerationOptions({ temperature: 0.2 })).toEqual({});
  });

  it("allows Azure temperature when explicitly enabled", () => {
    process.env.AI_PROVIDER = "azure";
    process.env.AZURE_INCLUDE_TEMPERATURE = "true";

    expect(getProviderGenerationOptions({ temperature: 0.2 })).toEqual({
      temperature: 0.2,
    });
  });
});
