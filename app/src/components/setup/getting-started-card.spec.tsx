import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FEATURES, makeResponse } from "./test-fixtures";
import { createWrapper } from "./test-wrapper";
import { DashboardGettingStarted, GettingStartedCard } from "./getting-started-card";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: jest.fn() }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContextSafe: jest.fn() }));

const { useAppConfig } = jest.requireMock("@/hooks/use-app-config") as { useAppConfig: jest.Mock };
const { useProjectContextSafe } = jest.requireMock("@/hooks/use-project-context") as { useProjectContextSafe: jest.Mock };
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock } };

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  toast.error.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  useAppConfig.mockReturnValue({ setupFeatures: FEATURES });
  useProjectContextSafe.mockReturnValue({ currentProject: { id: "p-1" } });
});

const items = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, group: "watch" as const, title: `Item ${i}`, done: i < 2, href: `/x${i}` }));

describe("GettingStartedCard", () => {
  const checklist = { items, done: 2, total: 8, nextSteps: [] };

  it("shows progress, the first six items and Start setup", () => {
    render(<GettingStartedCard checklist={{ ...checklist, done: 0 }} status="not_started" canEdit projectId="p-1" onDismiss={jest.fn()} />);
    expect(screen.getByTestId("getting-started-card")).toBeTruthy();
    expect(screen.getByText("Getting started")).toBeTruthy();
    expect(screen.getByText("0 of 8 done")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Start setup" }).getAttribute("href")).toBe("/setup?project=p-1");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("offers Continue once started, and Dismiss calls back", () => {
    const onDismiss = jest.fn();
    render(<GettingStartedCard checklist={checklist} status="in_progress" canEdit projectId="p-1" onDismiss={onDismiss} />);
    expect(screen.getByRole("link", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("is read-only for viewers and handles an empty checklist", () => {
    render(<GettingStartedCard checklist={{ items: [], done: 0, total: 0, nextSteps: [] }} status="not_started" canEdit={false} projectId="p-1" />);
    expect(screen.getByRole("link", { name: "View checklist" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});

describe("DashboardGettingStarted", () => {
  const fallback = <p>Empty state</p>;
  const reply = (response: ReturnType<typeof makeResponse>) => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => response });

  it("replaces the empty state with the card while setup is open", async () => {
    reply(makeResponse());
    const { Wrapper } = createWrapper();
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: Wrapper });
    expect(screen.getByTestId("getting-started-skeleton")).toBeTruthy();
    expect(await screen.findByTestId("getting-started-card")).toBeTruthy();
    expect(screen.queryByText("Empty state")).toBeNull();
  });

  it.each(["completed", "dismissed"] as const)("keeps the empty state when setup is %s", async (status) => {
    reply(makeResponse({}, { status }));
    const { Wrapper } = createWrapper();
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: Wrapper });
    expect(await screen.findByText("Empty state")).toBeTruthy();
  });

  it("on a project with data shows only while setup is in progress, with no skeleton", async () => {
    reply({ ...makeResponse({}, { status: "not_started" }), projectEmpty: false });
    const first = render(<DashboardGettingStarted dashboardHasData fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    expect(screen.queryByTestId("getting-started-skeleton")).toBeNull();
    expect(await screen.findByText("Empty state")).toBeTruthy();
    expect(screen.queryByTestId("getting-started-card")).toBeNull();
    first.unmount();

    reply(makeResponse({}, { status: "in_progress" }));
    render(<DashboardGettingStarted dashboardHasData fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    expect(await screen.findByTestId("getting-started-card")).toBeTruthy();
  });

  it("follows the sidebar rule: not started shows the card only when the project is empty", async () => {
    reply({ ...makeResponse({}, { status: "not_started" }), projectEmpty: false });
    const first = render(<DashboardGettingStarted fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    expect(await screen.findByText("Empty state")).toBeTruthy();
    first.unmount();
    reply({ ...makeResponse({}, { status: "not_started" }), projectEmpty: true });
    render(<DashboardGettingStarted dashboardHasData fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    expect(await screen.findByTestId("getting-started-card")).toBeTruthy();
  });

  it("keeps the empty state when the flag is off, with no project, or on error", async () => {
    const { Wrapper } = createWrapper();
    useAppConfig.mockReturnValue({ setupFeatures: { ...FEATURES, setup: false } });
    const { unmount } = render(<DashboardGettingStarted fallback={fallback} />, { wrapper: Wrapper });
    expect(screen.getByText("Empty state")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();

    useAppConfig.mockReturnValue({ setupFeatures: FEATURES });
    useProjectContextSafe.mockReturnValue(null);
    const second = render(<DashboardGettingStarted fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    expect(screen.getByText("Empty state")).toBeTruthy();
    second.unmount();

    useProjectContextSafe.mockReturnValue({ currentProject: { id: "p-1" } });
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    // The hook retries once (1 s) before reporting the error.
    expect(await screen.findByText("Empty state", {}, { timeout: 4000 })).toBeTruthy();
  });

  it("dismisses with a PUT and then shows the empty state", async () => {
    const open = makeResponse({}, { updatedAt: "t1" });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => open });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeResponse({}, { status: "dismissed", updatedAt: "t2" }) });
    const { Wrapper } = createWrapper();
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Empty state")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expectedUpdatedAt: "t1", status: "dismissed" });
  });

  it("sends one dismissal when Dismiss is clicked twice", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeResponse({}, { updatedAt: "t1" }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeResponse({}, { status: "dismissed", updatedAt: "t2" }) });
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: createWrapper().Wrapper });
    const button = await screen.findByRole("button", { name: "Dismiss" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("Empty state")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tells the user when dismissing fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => makeResponse() });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "conflict" }) });
    const { Wrapper } = createWrapper();
    render(<DashboardGettingStarted fallback={fallback} />, { wrapper: Wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("getting-started-card")).toBeTruthy();
    // The failed write invalidates the setup query, so a third request refetches the current state.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][1]?.method).toBeUndefined();
  });
});
