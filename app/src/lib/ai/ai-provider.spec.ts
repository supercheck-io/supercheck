import { getProviderGenerationOptions } from "./ai-provider";

describe("getProviderGenerationOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
    delete process.env.AZURE_INCLUDE_TEMPERATURE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes temperature for non-Azure providers", () => {
    process.env.AI_PROVIDER = "openai";

    expect(getProviderGenerationOptions({ temperature: 0.2 })).toEqual({
      temperature: 0.2,
    });
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
