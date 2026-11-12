import { render, waitFor } from "@testing-library/react";

const init = jest.fn();
const setUser = jest.fn();
const stopReplay = jest.fn();
const processors: Array<(event: Record<string, unknown>) => unknown> = [];
const sdkLoaded = jest.fn();
jest.mock("@sentry/react", () => {
  sdkLoaded();
  return {
    init,
    setUser,
    getReplay: () => ({ stop: stopReplay }),
    addEventProcessor: (fn: (event: Record<string, unknown>) => unknown) => processors.push(fn),
    browserTracingIntegration: jest.fn((o: unknown) => ({ name: "BrowserTracing", o })),
    replayIntegration: jest.fn((o: unknown) => ({ name: "Replay", o })),
  };
});

let mockPathname = "/";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));

const CONFIG = {
  dsn: "https://k@o1.ingest.sentry.io/1",
  environment: "test",
  release: "1.0.0",
  tracesSampleRate: 0.5,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
};

function setPath(path: string) {
  mockPathname = path;
  window.history.replaceState({}, "", path);
}

import { SentryBrowser, isExcludedPath, resetSentryBrowserForTest } from "./sentry-browser";

describe("SentryBrowser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    processors.length = 0;
    setPath("/");
    resetSentryBrowserForTest();
  });

  it("never fetches config or loads the SDK on an excluded page", async () => {
    setPath("/sign-in");
    global.fetch = jest.fn();
    render(<SentryBrowser />);
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });

  it("does not load the SDK when the config has no DSN", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({}) });
    render(<SentryBrowser />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/client-config/sentry", { cache: "no-store" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(init).not.toHaveBeenCalled();
  });

  it("inits privately with a DSN, sets the user id only, and drops sends on excluded pages", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => CONFIG });
    render(<SentryBrowser />);
    await waitFor(() => expect(setUser).toHaveBeenCalledWith({ id: "u1" }));
    const opts = init.mock.calls[0][0];
    expect(opts).toMatchObject({ dsn: CONFIG.dsn, sendDefaultPii: false, maxBreadcrumbs: 0, tracePropagationTargets: [/^\//] });
    expect(opts.integrations.map((i: { name: string }) => i.name)).toEqual(["BrowserTracing", "Replay"]);
    const replayOpts = opts.integrations[1].o;
    expect(replayOpts).toMatchObject({ maskAllText: true, maskAllInputs: true, blockAllMedia: true, networkDetailAllowUrls: [] });
    expect(replayOpts.maskAttributes).toEqual(expect.arrayContaining(["href", "src"]));
    expect(opts.integrations[0].o.enableInp).toBe(false);

    // Scrubs on an app page.
    const event = { message: "boom for bob@example.com", user: { id: "u1", email: "x@y.z" } };
    expect(opts.beforeSend(event)).toMatchObject({ message: "boom for [email]", user: { id: "u1" } });
    // Recording frames: URLs lose their query string.
    const frame = opts.integrations[1].o.beforeAddRecordingEvent({
      type: 5,
      data: { payload: { to: "/runs?token=secret", description: "https://customer.example.com/x?y=1" } },
    });
    expect(frame.data.payload).toEqual({ to: "/runs", description: "https://[target]" });
    // Replay events: URL list scrubbed, request removed.
    expect(processors[0]({ type: "replay_event", urls: ["/invite/abc?x=1"], request: { url: "x" } })).toEqual({
      type: "replay_event",
      urls: ["/invite/[token]"],
    });

    // After client navigation to an excluded page, nothing is sent and replay stops.
    setPath("/org-admin");
    expect(opts.beforeSend({ message: "x" })).toBeNull();
    expect(opts.beforeSendTransaction({ type: "transaction" })).toBeNull();
    expect(processors[0]({ type: "replay_event" })).toBeNull();
  });

  it("stops replay when the user navigates to an excluded page", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => CONFIG });
    const view = render(<SentryBrowser />);
    await waitFor(() => expect(init).toHaveBeenCalled());
    setPath("/billing");
    view.rerender(<SentryBrowser />);
    await waitFor(() => expect(stopReplay).toHaveBeenCalled());
  });

  it("retries a failed config fetch a bounded number of times", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline"));
    const view = render(<SentryBrowser />);
    for (const path of ["/a", "/b", "/c", "/d", "/e"]) {
      await new Promise((r) => setTimeout(r, 0));
      setPath(path);
      view.rerender(<SentryBrowser key={path} />);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect((global.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3);
    expect(init).not.toHaveBeenCalled();
  });
});

describe("isExcludedPath", () => {
  it.each([
    ["/status/abc", true],
    ["/sign-in", true],
    ["/invite/tok", true],
    ["/billing/success", true],
    ["/org-admin", true],
    ["/subscribe", true],
    ["/", false],
    ["/tests/123", false],
    ["/statuses", false],
  ])("%s -> %s", (path, expected) => {
    expect(isExcludedPath(path)).toBe(expected);
  });
});
