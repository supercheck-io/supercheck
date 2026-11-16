import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SetupDraft } from "@/lib/setup/draft-schema";
import type { ScanSummary } from "@/lib/setup/scan";
import { FEATURES, makeResponse, makeStepProps, PROJECT_ID } from "../test-fixtures";
import { TestsStep } from "./tests-step";

const scan: ScanSummary = { finalUrl: "https://app.example.com/", reachable: true, status: 200, redirects: 0, responseMs: 100, ssl: null, pages: [{ path: "/pricing", status: 200, ms: 1, title: null }] };
// The scan on screen must match the app URL of the draft.
const APP = { app: { url: "https://app.example.com" } };
const mk = (o: Parameters<typeof makeStepProps>[0] = {}) => makeStepProps({ ...o, draft: { ...APP, ...o.draft } });
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function drafting(initial: SetupDraft = {}) {
  let draft = initial;
  const patchDraft = jest.fn((fn: (d: SetupDraft) => SetupDraft) => {
    draft = fn(draft);
  });
  return { patchDraft, get: () => draft };
}
const suggest = () => fireEvent.click(screen.getByRole("button", { name: /Suggest/ }));
const SUGGESTIONS = { requirements: [{ title: "User can sign in", description: "Happy path", priority: "high" }, { title: "User can pay", description: "", priority: "medium" }] };

describe("TestsStep", () => {
  it("shows Beta and the cost before anyone clicks Suggest", () => {
    render(<TestsStep {...mk({ scan })} />);
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByTestId("setup-tests-cost").textContent).toBe("Suggesting requirements uses 1 AI credit, once per project per day.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is locked on a trial with an upgrade link and no Suggest button", () => {
    render(<TestsStep {...mk({ scan, response: makeResponse({ aiTestsLocked: true }) })} />);
    expect(screen.getByTestId("setup-tests-locked")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe("/billing");
    expect(screen.queryByRole("button", { name: /Suggest/ })).toBeNull();
  });

  it("locks after a 402 plan_required answer", async () => {
    fetchMock.mockReturnValue(json({ code: "plan_required" }, 402));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    expect(await screen.findByTestId("setup-tests-locked")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/projects/${PROJECT_ID}/setup/suggest-requirements`);
  });

  it("needs a scan before it offers Suggest", () => {
    render(<TestsStep {...makeStepProps()} />);
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeDisabled();
    expect(screen.getByText(/Scan your app first/)).toBeTruthy();
  });

  it("sends the pages of the scan on screen and never a scan of another URL", async () => {
    fetchMock.mockReturnValue(json(SUGGESTIONS));
    const withRedirect: ScanSummary = { ...scan, pages: [...scan.pages, { path: "/account", status: 200, ms: 1, title: "Sign in", redirected: true, finalPath: "/login" }] };
    render(<TestsStep {...mk({ scan: withRedirect })} />);
    suggest();
    await screen.findByText("User can sign in");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pages: [{ path: "/pricing", title: null }] });
    cleanup();
    render(<TestsStep {...mk({ scan, draft: { app: { url: "https://other.test" } } })} />);
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeDisabled();
    expect(screen.getByText(/Scan your app first/)).toBeTruthy();
  });

  it("tells the user a failed answer used no credit and when suggestions return", async () => {
    fetchMock.mockReturnValue(json({ code: "unusable_output", retryAt: "2030-01-01T00:00:00.000Z" }, 502));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    const text = (await screen.findByText(/No credit was used/)).textContent ?? "";
    expect(text).toMatch(/available again/);
    expect(text).not.toMatch(/Try again\./);
  });

  it("disables Suggest when ten requirements are ticked", () => {
    const requirements = Array.from({ length: 10 }, (_, i) => ({ title: `R${i}` }));
    render(<TestsStep {...mk({ scan, draft: { tests: { requirements } } })} />);
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeDisabled();
    expect(screen.getByText(/Untick some/)).toBeTruthy();
  });

  it("lists suggestions unticked and writes only ticked ones to the draft", async () => {
    fetchMock.mockReturnValue(json(SUGGESTIONS));
    const d = drafting();
    const { rerender } = render(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    suggest();
    await screen.findByText("User can sign in");
    expect(screen.getByLabelText(/User can sign in/)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(/User can sign in/));
    expect(d.get().tests?.requirements).toEqual([{ title: "User can sign in", description: "Happy path", priority: "high" }]);
    rerender(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getByLabelText(/User can pay/));
    expect(d.get().tests?.requirements).toEqual([{ title: "User can sign in", description: "Happy path", priority: "high" }, { title: "User can pay", priority: "medium" }]);
    rerender(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getByLabelText(/User can sign in/));
    expect(d.get().tests?.requirements).toEqual([{ title: "User can pay", priority: "medium" }]);
    expect(screen.getByRole("button", { name: "Suggest more" })).toBeTruthy();
  });

  it("keeps ticked requirements when the step is revisited", () => {
    render(<TestsStep {...mk({ scan, draft: { tests: { requirements: [{ title: "Kept", description: "d" }] } } })} />);
    expect(screen.getByLabelText(/Kept/)).toBeChecked();
  });

  it("saves every suggestion in the draft and restores the unticked ones on revisit", async () => {
    fetchMock.mockReturnValue(json(SUGGESTIONS));
    const d = drafting();
    render(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    suggest();
    await screen.findByText("User can sign in");
    expect(d.get().tests?.suggestions).toEqual([
      { title: "User can sign in", description: "Happy path", priority: "high" },
      { title: "User can pay", priority: "medium" },
    ]);
    expect(d.get().tests?.requirements).toEqual([]);
    cleanup();
    render(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    expect(screen.getByLabelText(/User can pay/)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(/User can pay/));
    expect(d.get().tests?.suggestions).toHaveLength(2);
  });

  it("keeps an option ticked while the request was running", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const old = Array.from({ length: 10 }, (_, i) => ({ title: `Old ${i}` }));
    const d = drafting({ tests: { requirements: [], suggestions: old } });
    const { rerender } = render(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    suggest();
    fireEvent.click(screen.getByLabelText(/Old 3/));
    rerender(<TestsStep {...mk({ scan, patchDraft: d.patchDraft, draft: d.get() })} />);
    resolve(await json({ requirements: Array.from({ length: 10 }, (_, i) => ({ title: `New ${i}`, description: "" })) }));
    await screen.findByLabelText(/New 0/);
    expect(screen.getByLabelText(/Old 3/)).toBeChecked();
  });

  it("explains the daily limit with the retry time", async () => {
    fetchMock.mockReturnValue(json({ code: "daily_limit", retryAt: "2030-01-01T00:00:00.000Z" }, 429));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    expect((await screen.findByText(/once per project per day. Try again after/)).textContent).toMatch(/2030|2029/);
  });

  it("falls back to 'tomorrow' without a retry time", async () => {
    fetchMock.mockReturnValue(json({ code: "daily_limit" }, 429));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    expect(await screen.findByText(/Try again after tomorrow/)).toBeTruthy();
  });

  it("stops offering suggestions on 503 (no AI provider)", async () => {
    fetchMock.mockReturnValue(json({ error: "AI provider is not configured" }, 503));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    expect(await screen.findByTestId("setup-tests-unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Suggest/ })).toBeNull();
  });

  it("handles credits exhausted, other errors and network failures, and allows retry", async () => {
    fetchMock.mockReturnValueOnce(json({ code: "credits_exhausted" }, 402));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    expect(await screen.findByText(/AI credits are used up/)).toBeTruthy();
    fetchMock.mockReturnValueOnce(json({ error: "AI could not produce suggestions. Try again." }, 502));
    suggest();
    expect(await screen.findByText("AI could not produce suggestions. Try again.")).toBeTruthy();
    fetchMock.mockReturnValueOnce(Promise.reject(new Error("net")));
    suggest();
    expect(await screen.findByText(/Check your connection/)).toBeTruthy();
    fetchMock.mockReturnValueOnce(json(SUGGESTIONS));
    suggest();
    await waitFor(() => expect(screen.getByText("User can pay")).toBeTruthy());
    expect(screen.queryByText(/Check your connection/)).toBeNull();
  });

  it("de-duplicates repeated suggestions by title", async () => {
    fetchMock.mockReturnValue(json(SUGGESTIONS));
    render(<TestsStep {...mk({ scan })} />);
    suggest();
    await screen.findByText("User can sign in");
    suggest();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("User can sign in")).toHaveLength(1);
  });

  it("shows Ask a project admin without test:create, and still links the agent test", () => {
    const response = makeResponse();
    render(<TestsStep {...makeStepProps({ permissions: { ...response.permissions, canCreateTests: false } })} />);
    expect(screen.getByText(/Ask a project admin/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Suggest/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Create an agent test" }).getAttribute("href")).toBe("/playground?scriptType=agent");
  });

  it("hides the agent test card when its flag is off, and disables Suggest read-only", () => {
    render(<TestsStep {...mk({ scan, readOnly: true, features: { ...FEATURES, agentTest: false } })} />);
    expect(screen.queryByTestId("setup-card-agent-test")).toBeNull();
    expect(screen.getByRole("button", { name: /Suggest/ })).toBeDisabled();
  });
});
