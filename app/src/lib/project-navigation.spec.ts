/** @jest-environment node */
import { clearQueryCache } from "@/lib/query-provider";
import { announceProjectChange, listenForProjectChanges, reloadProjectContext } from "./project-navigation";
jest.mock("@/lib/query-provider", () => ({ clearQueryCache: jest.fn() }));

describe("project navigation cache isolation", () => {
  const originals = new Map(["window", "localStorage", "BroadcastChannel"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const replace = jest.fn();
  const clearProjects = jest.fn();
  const listeners = new Map<string, (event: unknown) => void>();
  const close = jest.fn();
  const postMessage = jest.fn();
  let channel: { onmessage: (() => void) | null };
  beforeEach(() => {
    jest.clearAllMocks(); listeners.clear();
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { origin: "https://app.supercheck.io", replace },
      addEventListener: jest.fn((name, listener) => listeners.set(name, listener)),
      removeEventListener: jest.fn((name) => listeners.delete(name)),
    } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: jest.fn() } });
    Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: jest.fn(() => {
      channel = { onmessage: null }; return Object.assign(channel, { close, postMessage });
    }) });
  });
  afterAll(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  it("clears both caches before reloading the same origin", () => {
    reloadProjectContext(clearProjects);
    expect(clearProjects).toHaveBeenCalled(); expect(clearQueryCache).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(new URL("https://app.supercheck.io/"));
    expect((clearQueryCache as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });
  it("clears other tabs once for storage and broadcast signals and cleans up listeners", () => {
    const unsubscribe = listenForProjectChanges(clearProjects);
    listeners.get("storage")?.({ key: "unrelated", newValue: "x" });
    expect(replace).not.toHaveBeenCalled();
    listeners.get("storage")?.({ key: "supercheck-project-change", newValue: "x" });
    channel.onmessage?.();
    expect(clearQueryCache).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledTimes(1);
    unsubscribe(); expect(listeners.size).toBe(0); expect(close).toHaveBeenCalled();
  });
  it("broadcasts when local storage is unavailable", () => {
    (localStorage.setItem as jest.Mock).mockImplementation(() => { throw new Error("disabled"); });
    expect(() => announceProjectChange()).not.toThrow();
    expect(postMessage).toHaveBeenCalledWith("changed");
  });
});
