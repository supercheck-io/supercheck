import { act, renderHook } from "@testing-library/react";

import { makeResponse, PROJECT_ID } from "./test-fixtures";
import { createWrapper } from "./test-wrapper";
import { useSetupSession } from "./use-setup-session";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const ID_A = "00000000-0000-4000-8000-00000000000a";
const TAB = "00000000-0000-4000-8000-0000000000aa";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const fetchMock = jest.fn();
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ ok: status < 400, status, json: async () => body, headers: { get: (name: string) => headers[name] ?? null } });
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

const setup = () => {
  const initial = makeResponse({}, { status: "in_progress", updatedAt: "t0" }).state;
  return renderHook(() => useSetupSession(PROJECT_ID, initial, TAB, 10), { wrapper: createWrapper().Wrapper });
};

describe("useSetupSession flush", () => {
  it("resolves true when saved and false when the write failed, and sends the tab token", async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: "boom" }));
    fetchMock.mockResolvedValueOnce(reply(200, makeResponse({}, { updatedAt: "t1" })));
    const { result } = setup();
    act(() => result.current.patch({ currentStep: "alerts" }));
    let first = true;
    await act(async () => { first = await result.current.flush(); });
    expect(first).toBe(false);
    let second = false;
    await act(async () => { second = await result.current.flush(); });
    expect(second).toBe(true);
    expect(puts().every((body) => body.lockToken === TAB)).toBe(true);
  });
});

describe("useSetupSession recordCreated", () => {
  it("keeps a locally created id through a 409 and re-saves it on the server version", async () => {
    const server = makeResponse({}, { status: "in_progress", updatedAt: "t-server", draft: { created: { "monitor:other": ID_B } } });
    fetchMock.mockResolvedValueOnce(reply(409, { error: "conflict", state: server.state }));
    fetchMock.mockResolvedValueOnce(reply(200, makeResponse({}, { updatedAt: "t-new", draft: { created: { "monitor:a": ID_A, "monitor:other": ID_B } } })));
    const { result } = setup();
    await act(async () => { await result.current.recordCreated("monitor:a", ID_A); });
    const sent = puts();
    expect(sent).toHaveLength(2);
    expect(sent[1].expectedUpdatedAt).toBe("t-server");
    expect(sent[1].draft.created).toEqual({ "monitor:a": ID_A, "monitor:other": ID_B });
    expect(result.current.getCreated()).toEqual({ "monitor:a": ID_A, "monitor:other": ID_B });
  });

  it("coalesces rapid calls into one PUT", async () => {
    fetchMock.mockResolvedValue(reply(200, makeResponse({}, { updatedAt: "t1" })));
    const { result } = setup();
    await act(async () => {
      await Promise.all([result.current.recordCreated("monitor:a", ID_A), result.current.recordCreated("monitor:b", ID_B)]);
    });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].draft.created).toEqual({ "monitor:a": ID_A, "monitor:b": ID_B });
  });

  it("retries a 429 after Retry-After, at most three times", async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockResolvedValueOnce(reply(429, { error: "Too many requests" }, { "Retry-After": "7" }));
      fetchMock.mockResolvedValueOnce(reply(200, makeResponse({}, { updatedAt: "t1" })));
      const { result } = setup();
      act(() => result.current.patch({ currentStep: "alerts" }));
      let ok: Promise<boolean> = Promise.resolve(false);
      act(() => { ok = result.current.flush(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(6_000); });
      expect(puts()).toHaveLength(1);
      await act(async () => { await jest.advanceTimersByTimeAsync(1_000); });
      expect(await ok).toBe(true);
      expect(puts()).toHaveLength(2);

      fetchMock.mockReset();
      fetchMock.mockResolvedValue(reply(429, { error: "Too many requests" }, { "Retry-After": "120" }));
      act(() => result.current.patch({ currentStep: "monitors" }));
      act(() => { ok = result.current.flush(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(3 * 30_000); });
      expect(await ok).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects when the write did not persist, so the runner shows the item as failed", async () => {
    fetchMock.mockResolvedValue(reply(500, { error: "boom" }));
    const { result } = setup();
    await act(async () => {
      await expect(result.current.recordCreated("monitor:a", ID_A)).rejects.toThrow(/could not be saved/);
    });
    expect(result.current.saveState).toBe("error");
    // The id stays in the local draft and is still dirty for the next flush.
    expect(result.current.getCreated()).toEqual({ "monitor:a": ID_A });
  });

  it("rejects when the re-save after a 409 conflicts again", async () => {
    const server = makeResponse({}, { updatedAt: "t-server" }).state;
    fetchMock.mockResolvedValue(reply(409, { error: "conflict", state: server }));
    const { result } = setup();
    await act(async () => {
      await expect(result.current.recordCreated("monitor:a", ID_A)).rejects.toThrow();
    });
  });

  it("resolves when the server version already holds the id", async () => {
    const server = makeResponse({}, { updatedAt: "t-server", draft: { created: { "monitor:a": ID_A } } });
    fetchMock.mockResolvedValueOnce(reply(409, { error: "conflict", state: server.state }));
    const { result } = setup();
    await act(async () => { await result.current.recordCreated("monitor:a", ID_A); });
    expect(puts()).toHaveLength(1);
  });
});
