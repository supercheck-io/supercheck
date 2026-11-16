import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FEATURES, makeResponse, PROJECT_ID } from "./test-fixtures";
import { createWrapper } from "./test-wrapper";
import { SetupWizard } from "./wizard";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: jest.fn() }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: jest.fn() }));
jest.mock("@/actions/create-component", () => ({ createComponent: jest.fn() }));
jest.mock("@/actions/create-status-page", () => ({ createStatusPage: jest.fn() }));
jest.mock("@/actions/get-status-pages", () => ({ getStatusPages: jest.fn() }));
jest.mock("@/actions/publish-status-page", () => ({ publishStatusPage: jest.fn() }));
jest.mock("@/actions/notification-policy", () => ({ getProjectNotificationPolicy: jest.fn(), saveProjectNotificationPolicy: jest.fn() }));

const { useAppConfig } = jest.requireMock("@/hooks/use-app-config") as { useAppConfig: jest.Mock };
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock } };

type Call = { url: string; method: string; body?: Record<string, unknown>; keepalive?: boolean };
let calls: Call[];
let lockStatus: number;
let lockGate: Promise<void> | null;
let lockSameUser = false;
let putHandler: (call: Call) => { status: number; body: unknown };

const fetchMock = jest.fn(async (url: string, init?: { method?: string; body?: string; keepalive?: boolean }) => {
  const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined, keepalive: init?.keepalive };
  calls.push(call);
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  if (url.endsWith("/setup/lock")) {
    if (call.method === "DELETE") return reply(204, {});
    if (lockGate) await lockGate;
    return lockStatus === 423 && !call.body?.takeover && !call.body?.force
      ? reply(423, { error: "locked", lock: lockSameUser ? { userId: "u1", userName: "Me", lockedAt: new Date().toISOString(), mine: false, sameUser: true } : { userId: "u2", userName: "Priya Shah", lockedAt: new Date(Date.now() - 6 * 60_000).toISOString(), mine: false } })
      : reply(200, { lock: { userId: "u1", userName: "Me", lockedAt: new Date().toISOString(), mine: true } });
  }
  if (call.method === "PUT") {
    const { status, body } = putHandler(call);
    return reply(status, body);
  }
  return reply(200, {});
});

beforeEach(() => {
  calls = [];
  lockStatus = 200;
  lockSameUser = false;
  lockGate = null;
  push.mockReset();
  toast.error.mockReset();
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  useAppConfig.mockReturnValue({ setupFeatures: FEATURES });
  let n = 0;
  putHandler = (call) => ({ status: 200, body: makeResponse({}, { status: "in_progress", updatedAt: `t${++n}`, currentStep: (call.body?.currentStep as never) ?? null }) });
});

const puts = () => calls.filter((c) => c.method === "PUT");
const renderWizard = (response = makeResponse(), persona: Parameters<typeof SetupWizard>[0]["persona"] = null) => {
  const { Wrapper } = createWrapper();
  return render(<SetupWizard response={response} persona={persona} userEmail="me@example.com" />, { wrapper: Wrapper });
};
const leaveAndFlush = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
  expect(await screen.findByText("Leave setup?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Leave and resume later" }));
};

describe("step rail", () => {
  it("lists the default order as a labelled nav with the current step marked", () => {
    useAppConfig.mockReturnValue({ setupFeatures: { ...FEATURES, aiTests: false, aiSre: false } });
    renderWizard();
    const nav = screen.getByRole("navigation", { name: "Setup steps" });
    expect(Array.from(nav.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"))).toEqual([
      "setup-step-app",
      "setup-step-alerts",
      "setup-step-monitors",
      "setup-step-statusPage",
      "setup-step-review",
    ]);
    expect(screen.getByTestId("setup-step-app").getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  });

  it("orders steps by persona, with the AI steps once their flags are on", () => {
    useAppConfig.mockReturnValue({ setupFeatures: { ...FEATURES, aiTests: true, aiSre: true } });
    renderWizard(makeResponse(), "developer");
    const ids = Array.from(screen.getByRole("navigation", { name: "Setup steps" }).querySelectorAll("button")).map((b) => b.getAttribute("data-testid"));
    expect(ids).toEqual(["setup-step-developer", "setup-step-app", "setup-step-monitors", "setup-step-alerts", "setup-step-tests", "setup-step-statusPage", "setup-step-aiSre", "setup-step-review"]);
    expect(screen.getByText("npx supercheck login --json")).toBeTruthy();
  });

  it("shows the invite step first for the leader persona", () => {
    renderWizard(makeResponse(), "leader");
    expect(screen.getByTestId("setup-step-invite").getAttribute("aria-current")).toBe("step");
  });

  it("resumes at the saved step", () => {
    renderWizard(makeResponse({}, { status: "in_progress", currentStep: "monitors" }));
    expect(screen.getByTestId("setup-step-monitors").getAttribute("aria-current")).toBe("step");
  });
});

describe("navigation and draft", () => {
  it("Continue, Skip and Back move through steps and save the position and skipped steps", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("setup-step-alerts").getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByTestId("setup-step-monitors").getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Skipped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("setup-step-alerts").getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByTestId("setup-step-statusPage"));
    expect(screen.getByTestId("setup-step-statusPage").getAttribute("aria-current")).toBe("step");

    await leaveAndFlush();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    const last = puts().at(-1)?.body;
    expect(last).toMatchObject({ currentStep: "statusPage", skipped: ["alerts"] });
    expect(puts()[0].url).toBe(`/api/projects/${PROJECT_ID}/setup`);
  });

  it("marks a not-started setup in progress and shows Draft saved", async () => {
    renderWizard();
    await leaveAndFlush();
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body).toMatchObject({ status: "in_progress", expectedUpdatedAt: null });
  });

  it("continuing a skipped step clears its skipped mark", async () => {
    renderWizard(makeResponse({}, { status: "in_progress", currentStep: "alerts", skipped: ["alerts"] }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await leaveAndFlush();
    await waitFor(() => expect(puts().length).toBeGreaterThan(0));
    expect(puts().at(-1)?.body?.skipped).toEqual([]);
  });

  it("autosaves after a pause and shows Draft saved", async () => {
    jest.useFakeTimers();
    try {
      renderWizard(makeResponse({}, { status: "in_progress" }));
      fireEvent.change(screen.getByLabelText("App URL"), { target: { value: "https://app.example.com/?x=1" } });
      await act(async () => {
        jest.advanceTimersByTime(900);
      });
      jest.useRealTimers();
      expect(await screen.findByText("Draft saved")).toBeTruthy();
      expect(puts()[0].body?.draft).toMatchObject({ app: { url: "https://app.example.com/" } });
    } finally {
      jest.useRealTimers();
    }
  });

  it("reloads the saved state and tells the user on a 409", async () => {
    putHandler = () => ({ status: 409, body: { error: "conflict", state: makeResponse({}, { status: "in_progress", currentStep: "monitors", updatedAt: "server" }).state } });
    renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await leaveAndFlush();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("changed somewhere else")));
    expect(screen.getByTestId("setup-step-monitors").getAttribute("aria-current")).toBe("step");
  });

  it("keeps the change and offers a retry when saving fails", async () => {
    putHandler = () => ({ status: 500, body: { error: "boom" } });
    renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await leaveAndFlush();
    expect(await screen.findByText("Could not save the draft: boom")).toBeTruthy();
    // The dialog offers a way out that does not pretend the draft was saved.
    expect(screen.getByRole("button", { name: "Leave without saving" })).toBeTruthy();
    // Leaving would lose the draft: the dialog stays open with the reason and nothing navigates.
    expect(await screen.findByText(/Your draft could not be saved/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    putHandler = () => ({ status: 200, body: makeResponse({}, { updatedAt: "ok" }) });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Draft saved")).toBeTruthy();
  });

  it("lets an owner dismiss setup from the exit dialog", async () => {
    renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss setup" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(puts().some((c) => (c.body as { status?: string })?.status === "dismissed")).toBe(true);
  });

  it("says created items stay once something was created", async () => {
    const created = { "monitor:website:abc": "00000000-0000-4000-8000-000000000009" };
    renderWizard(makeResponse({}, { status: "in_progress", draft: { created } }));
    fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
    expect(await screen.findByText(/already created stay in your project/)).toBeTruthy();
    expect(screen.queryByText(/Nothing has been created yet/)).toBeNull();
  });

  it("keeps the dialog closed when the user keeps going", async () => {
    renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit setup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep going" }));
    await waitFor(() => expect(screen.queryByText("Leave setup?")).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });
});

describe("lock", () => {
  it("takes the lock on enter and releases it on exit", async () => {
    const view = renderWizard(makeResponse({}, { status: "in_progress" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/setup/lock") && c.method === "POST")).toBe(true));
    view.unmount();
    expect(calls.some((c) => c.url.endsWith("/setup/lock") && c.method === "DELETE")).toBe(true);
  });

  it("sends one per-tab token on the lock claim, the draft saves and the release", async () => {
    const view = renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await leaveAndFlush();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    view.unmount();
    const tokens = new Set(
      calls.filter((c) => c.url.endsWith("/setup/lock") || c.method === "PUT").map((c) => c.body?.lockToken),
    );
    expect(tokens.size).toBe(1);
    expect([...tokens][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.some((c) => c.method === "DELETE" && c.body?.lockToken === [...tokens][0])).toBe(true);
  });

  it("heartbeats every 60 seconds", async () => {
    jest.useFakeTimers();
    try {
      renderWizard(makeResponse({}, { status: "in_progress" }));
      await act(async () => {
        jest.advanceTimersByTime(120_000);
      });
      expect(calls.filter((c) => c.url.endsWith("/setup/lock") && c.method === "POST").length).toBeGreaterThanOrEqual(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("shows who holds the lock on a 423 and goes read-only", async () => {
    lockStatus = 423;
    renderWizard(makeResponse({}, { status: "in_progress" }));
    expect(await screen.findByTestId("setup-locked")).toBeTruthy();
    expect(screen.getByText("Setup is already running")).toBeTruthy();
    expect(screen.getByText(/Priya Shah started it 6 minutes ago/)).toBeTruthy();
    expect(screen.getByLabelText("App URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip this step" })).toBeDisabled();
  });

  it("says setup is open in another tab and reclaims explicitly with Use this tab instead", async () => {
    lockStatus = 423;
    lockSameUser = true;
    renderWizard(makeResponse({}, { status: "in_progress" }));
    expect(await screen.findByText("Setup is open in another tab")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
    expect(screen.getByLabelText("App URL")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use this tab instead" }));
    await waitFor(() => expect(screen.queryByTestId("setup-other-tab")).toBeNull());
    expect(calls.some((c) => c.method === "POST" && c.body?.reclaim === true && c.body?.force === true)).toBe(true);
  });

  it("keeps Create disabled with a countdown for 35 s after a forced reclaim", async () => {
    lockStatus = 423;
    lockSameUser = true;
    renderWizard(makeResponse({}, { status: "in_progress", currentStep: "review", draft: { statusPage: { name: "Acme status" } } }));
    fireEvent.click(await screen.findByRole("button", { name: "Use this tab instead" }));
    jest.useFakeTimers();
    try {
      expect(await screen.findByTestId("setup-reclaim-wait")).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Create/ })).toBeDisabled();
      await act(async () => { await jest.advanceTimersByTimeAsync(35_000); });
      expect(screen.queryByTestId("setup-reclaim-wait")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("releases a lock whose claim finished after the wizard unmounted", async () => {
    let open: () => void = () => undefined;
    lockGate = new Promise<void>((resolve) => { open = resolve; });
    const view = renderWizard(makeResponse({}, { status: "in_progress" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    view.unmount();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    open();
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.keepalive)).toBe(true));
  });

  it("releases the lock with a keepalive request when the page is hidden", async () => {
    renderWizard(makeResponse({}, { status: "in_progress" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await act(async () => { await Promise.resolve(); });
    window.dispatchEvent(new Event("pagehide"));
    expect(calls.filter((c) => c.method === "DELETE" && c.keepalive)).toHaveLength(1);
  });

  it("lets a project admin take over a held lock, and hides the button from others", async () => {
    lockStatus = 423;
    const view = renderWizard(makeResponse({}, { status: "in_progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Take over" }));
    await waitFor(() => expect(screen.queryByTestId("setup-locked")).toBeNull());
    expect(calls.some((c) => c.method === "POST" && c.body?.takeover === true)).toBe(true);
    view.unmount();
    const base = makeResponse({}, { status: "in_progress" });
    renderWizard({ ...base, permissions: { ...base.permissions, canUpdateProject: false } });
    await screen.findByTestId("setup-locked");
    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
  });

  it("moves between steps locally, without saving, while read-only", async () => {
    lockStatus = 423;
    renderWizard(makeResponse({}, { status: "in_progress" }));
    await screen.findByTestId("setup-locked");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("setup-step-alerts").getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByTestId("setup-step-monitors"));
    expect(screen.getByTestId("setup-step-monitors").getAttribute("aria-current")).toBe("step");
    await leaveAndFlush();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(puts()).toHaveLength(0);
    expect(screen.queryByText("Could not save the draft")).toBeNull();
  });

  it("shows a lock already held by someone else before the first response", () => {
    lockStatus = 423;
    const lock = { userId: "u2", userName: null, lockedAt: new Date().toISOString(), mine: false };
    renderWizard(makeResponse({}, { status: "in_progress", lock }));
    expect(screen.getByText(/Someone started it just now/)).toBeTruthy();
  });

  it("is read-only without edit permission and never takes the lock", () => {
    const base = makeResponse({}, { status: "in_progress" });
    renderWizard({ ...base, permissions: { ...base.permissions, canEdit: false } });
    expect(screen.getByText("You have view access. A project admin can finish setup.")).toBeTruthy();
    expect(screen.getByLabelText("App URL")).toBeDisabled();
    expect(calls).toHaveLength(0);
  });
});
