/** @jest-environment node */

import { loadPlaywrightEditorTypes } from "./playwright-editor-types";

describe("Playwright editor type loading", () => {
  const uri = "file:///node_modules/@playwright/test/index.d.ts";
  const defaults = { getExtraLibs: jest.fn(() => ({})), addExtraLib: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    defaults.getExtraLibs.mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("recovers from failed requests and invalid JSON while still mounted", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: { [uri]: "export {};" } }) } as Response);
    const loading = loadPlaywrightEditorTypes(defaults);
    await jest.advanceTimersByTimeAsync(500);
    await loading;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(defaults.addExtraLib).toHaveBeenCalledWith("export {};", uri);

    fetchMock.mockReset()
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: { [uri]: "export {};" } }) } as Response);
    const retry = loadPlaywrightEditorTypes(defaults);
    await jest.advanceTimersByTimeAsync(250);
    await retry;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after three attempts and preserves the final error", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const rejected = expect(loadPlaywrightEditorTypes(defaults)).rejects.toThrow("offline");
    await jest.advanceTimersByTimeAsync(500);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(defaults.addExtraLib).not.toHaveBeenCalled();
  });

  it("does not refetch declarations already registered in Monaco", async () => {
    defaults.getExtraLibs.mockReturnValue({ [uri]: { content: "export {};", version: 1 } });
    const fetchMock = jest.spyOn(global, "fetch");
    await loadPlaywrightEditorTypes(defaults);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
