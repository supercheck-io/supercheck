import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FEATURES, makeResponse, PROJECT_ID } from "./test-fixtures";
import { getProjectSetupQueryKey } from "@/hooks/use-project-setup";
import { createWrapper } from "./test-wrapper";
import { SetupPage } from "./setup-page";
import { WelcomePage } from "./welcome-page";

const replace = jest.fn();
const push = jest.fn();
let search = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(search),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: jest.fn() }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: jest.fn() }));
jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: { user: { email: "me@example.com" } } }) }));
jest.mock("@/actions/create-component", () => ({ createComponent: jest.fn() }));
jest.mock("@/actions/create-status-page", () => ({ createStatusPage: jest.fn() }));
jest.mock("@/actions/get-status-pages", () => ({ getStatusPages: jest.fn() }));
jest.mock("@/actions/publish-status-page", () => ({ publishStatusPage: jest.fn() }));
jest.mock("@/actions/notification-policy", () => ({ getProjectNotificationPolicy: jest.fn(), saveProjectNotificationPolicy: jest.fn() }));

const { useAppConfig } = jest.requireMock("@/hooks/use-app-config") as { useAppConfig: jest.Mock };
const { useProjectContext } = jest.requireMock("@/hooks/use-project-context") as { useProjectContext: jest.Mock };

let setupBody: unknown;
let setupStatus: number;
let prefsBody: unknown;
const switchProject = jest.fn();
const fetchMock = jest.fn(async (url: string, init?: { method?: string }) => {
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  if (url.includes("/setup/lock")) return reply(200, {});
  if (url.endsWith("/setup") && init?.method === "PUT") return reply(200, setupBody);
  if (url.endsWith("/setup")) return reply(setupStatus, setupBody);
  if (url === "/api/me/preferences") return reply(200, prefsBody);
  return reply(404, {});
});

const refreshProjects = jest.fn();
const project = (role = "org_owner", id = PROJECT_ID) => ({ currentProject: { id, name: "Web App", userRole: role, organizationName: "Acme" }, switchProject, refreshProjects, loading: false });

beforeEach(() => {
  search = "";
  replace.mockReset();
  push.mockReset();
  switchProject.mockReset().mockResolvedValue(true);
  setupBody = makeResponse({}, { updatedAt: "t0" });
  setupStatus = 200;
  prefsBody = { persona: null, seen: true };
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  useAppConfig.mockReturnValue({ setupFeatures: FEATURES });
  useProjectContext.mockReturnValue(project());
});

const renderPage = (ui = <SetupPage />, wrapper = createWrapper().Wrapper) => render(ui, { wrapper });

describe("SetupPage view selection", () => {
  it("shows a skeleton while loading", () => {
    renderPage();
    expect(screen.getByTestId("setup-skeleton")).toBeTruthy();
  });

  it("opens the wizard for a creator who has seen the welcome", async () => {
    renderPage();
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });

  it("shows Welcome first for a creator who has not answered, then the wizard", async () => {
    prefsBody = { persona: null, seen: false };
    renderPage();
    expect(await screen.findByTestId("setup-welcome")).toBeTruthy();
    prefsBody = { persona: null, seen: true };
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });

  it("sends an invited member who has not answered to the welcome page", async () => {
    prefsBody = { persona: null, seen: false };
    useProjectContext.mockReturnValue(project("project_editor"));
    renderPage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup/welcome"));
  });

  it("asks for the project again while a fresh account has none yet", () => {
    jest.useFakeTimers();
    refreshProjects.mockClear();
    useProjectContext.mockReturnValue({ currentProject: null, switchProject, refreshProjects, loading: false });
    renderPage();
    act(() => {
      jest.advanceTimersByTime(4100);
    });
    expect(refreshProjects).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("does not send a fresh creator to the member welcome while the project is still loading", async () => {
    prefsBody = { persona: null, seen: false };
    useProjectContext.mockReturnValue({ currentProject: null, switchProject, refreshProjects, loading: false });
    const { rerender } = renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/me/preferences", expect.anything()));
    await act(async () => undefined);
    expect(replace).not.toHaveBeenCalled();
    useProjectContext.mockReturnValue(project());
    rerender(<SetupPage />);
    expect(await screen.findByRole("button", { name: /Start setup/ })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers the wizard to an invited editor on a not-started project instead of opening it", async () => {
    useProjectContext.mockReturnValue(project("project_editor"));
    renderPage();
    expect(await screen.findByTestId("setup-checklist-view")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });

  it("shows a read-only checklist for viewers", async () => {
    setupBody = { ...makeResponse(), permissions: { ...makeResponse().permissions, canEdit: false } };
    useProjectContext.mockReturnValue(project("project_viewer"));
    renderPage();
    expect(await screen.findByText("You have view access. A project admin can finish setup.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start setup" })).toBeNull();
    expect(screen.getByTestId("checklist-item-alerts")).toBeTruthy();
  });

  it("shows the checklist with Run setup again when setup is completed, and reopens the wizard", async () => {
    setupBody = makeResponse({}, { status: "completed", updatedAt: "t1" });
    renderPage();
    expect(await screen.findByRole("button", { name: "Run setup again" })).toBeTruthy();
    expect(screen.getByText("1 of 2 done in Web App")).toBeTruthy();
    setupBody = makeResponse({}, { status: "in_progress", updatedAt: "t2" });
    fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });

  it("explains a dismissed setup and Dismiss moves an open one there", async () => {
    setupBody = makeResponse({}, { status: "dismissed" });
    const first = renderPage();
    expect(await screen.findByText(/Getting started was dismissed/)).toBeTruthy();
    first.unmount();

    setupBody = makeResponse({}, { status: "not_started", updatedAt: "t1" });
    useProjectContext.mockReturnValue(project("project_editor"));
    renderPage();
    setupBody = makeResponse({}, { status: "dismissed", updatedAt: "t2" });
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText(/Getting started was dismissed/)).toBeTruthy();
  });

  it("shows an error with Retry when the state cannot be loaded", async () => {
    setupStatus = 500;
    setupBody = { error: "boom" };
    renderPage();
    expect(await screen.findByTestId("setup-error", {}, { timeout: 4000 })).toBeTruthy();
    setupStatus = 200;
    setupBody = makeResponse();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
  });
});

describe("SetupPage project switching", () => {
  it("switches to the project in the URL before loading its setup", async () => {
    search = "project=22222222-2222-4222-8222-222222222222";
    renderPage();
    await waitFor(() => expect(switchProject).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", "/setup?project=22222222-2222-4222-8222-222222222222"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/projects/22222222"))).toBe(false);
  });

  it("does not switch when the project is already active", async () => {
    search = `project=${PROJECT_ID}`;
    renderPage();
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
    expect(switchProject).not.toHaveBeenCalled();
  });

  it("shows an error when the switch fails", async () => {
    switchProject.mockResolvedValue(false);
    search = "project=22222222-2222-4222-8222-222222222222";
    renderPage();
    expect(await screen.findByText("The project could not be opened.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/");
    // Retry runs the switch again instead of leaving a skeleton.
    switchProject.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(switchProject).toHaveBeenCalledTimes(2));
  });
});

describe("WelcomePage", () => {
  it("asks invited members the persona question and goes to the dashboard", async () => {
    prefsBody = { persona: null, seen: false };
    renderPage(<WelcomePage />);
    expect(await screen.findByText("You joined Acme. What will you mostly do here?")).toBeTruthy();
    prefsBody = { persona: null, seen: true };
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("skips ahead to the dashboard when the question was already answered", async () => {
    renderPage(<WelcomePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows an error with Retry when preferences cannot be loaded", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    renderPage(<WelcomePage />);
    expect(await screen.findByText("Could not load your preferences", {}, { timeout: 4000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});

describe("SetupPage finishing", () => {
  it("keeps an auto-opened wizard on screen after setup completes", async () => {
    const { client, Wrapper } = createWrapper();
    renderPage(<SetupPage />, Wrapper);
    expect(await screen.findByTestId("setup-wizard")).toBeTruthy();
    act(() => {
      client.setQueryData(getProjectSetupQueryKey(PROJECT_ID), makeResponse({}, { status: "completed", updatedAt: "t9" }));
    });
    expect(screen.getByTestId("setup-wizard")).toBeTruthy();
    expect(screen.queryByTestId("setup-checklist-view")).toBeNull();
  });
});
