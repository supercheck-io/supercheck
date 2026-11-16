import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FEATURES, makeResponse, makeStepProps, PROJECT_ID } from "../test-fixtures";
import { AlertsStep, channelName } from "./alerts-step";
import { AppStep } from "./app-step";
import { DeveloperStep } from "./developer-step";
import { InviteStep } from "./invite-step";
import { MonitorsStep } from "./monitors-step";
import { StatusPageStep } from "./status-page-step";
import { responseError } from "./step-types";
import type { SetupDraft } from "@/lib/setup/draft-schema";

// Radix Select needs pointer-capture and scroll APIs that jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
const pick = (label: string, option: string | RegExp) => {
  fireEvent.keyDown(screen.getByLabelText(label), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PROVIDER = "00000000-0000-4000-8000-000000000001";
const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
let activeProject: string;
beforeEach(() => {
  fetchMock.mockReset();
  activeProject = PROJECT_ID;
  // The active-project check is answered here, so fetchMock only sees the step's own requests.
  global.fetch = ((url: string, init?: unknown) => (url === "/api/context" ? json({ project: { id: activeProject } }) : fetchMock(url, init))) as unknown as typeof fetch;
});

/** A patchDraft that applies the change to a draft we can inspect. */
function drafting(initial: SetupDraft = {}) {
  let draft = initial;
  const patchDraft = jest.fn((fn: (d: SetupDraft) => SetupDraft) => {
    draft = fn(draft);
  });
  return { patchDraft, get: () => draft };
}

describe("AlertsStep", () => {
  it("shows the repeat and warnings cards only when their flags are on", () => {
    const { rerender } = render(<AlertsStep {...makeStepProps()} />);
    expect(screen.getByTestId("setup-card-repeat")).toBeTruthy();
    expect(screen.getByTestId("setup-card-warnings")).toBeTruthy();
    rerender(<AlertsStep {...makeStepProps({ features: { ...FEATURES, repeatUntilAck: false, warningAlerts: false } })} />);
    expect(screen.queryByTestId("setup-card-repeat")).toBeNull();
    expect(screen.queryByTestId("setup-card-warnings")).toBeNull();
  });

  it("lets an editor see the repeat card disabled with the reason", () => {
    const response = makeResponse();
    const props = makeStepProps({ permissions: { ...response.permissions, canUpdateProject: false } });
    render(<AlertsStep {...props} />);
    expect(screen.getByLabelText("Repeat until acknowledged")).toBeDisabled();
    expect(screen.getByText(/Ask a project admin/)).toBeTruthy();
  });

  it("stores repeat and warning choices in the draft", () => {
    const d = drafting();
    render(<AlertsStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    fireEvent.click(screen.getByLabelText("Repeat until acknowledged"));
    fireEvent.click(screen.getByLabelText("Also alert on warnings"));
    expect(d.get().alerts).toMatchObject({ repeatUntilAck: { enabled: true, repeatMinutes: 15 }, warnings: true });
  });

  it("shows the repeat interval and saves a change", () => {
    const d = drafting({ alerts: { providerIds: [], repeatUntilAck: { enabled: true, repeatMinutes: 15 } } });
    render(<AlertsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    pick("Repeat every", "30 min");
    expect(d.get().alerts?.repeatUntilAck).toEqual({ enabled: true, repeatMinutes: 30 });
  });

  it("saves the prefilled email channel right away and keeps only its id in the draft", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (url === "/api/notification-providers" && init?.method === "POST") return json({ id: PROVIDER }, 201);
      return json({});
    });
    const d = drafting();
    render(<AlertsStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    expect((screen.getByLabelText("Email addresses") as HTMLInputElement).value).toBe("me@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    await waitFor(() => expect(d.get().alerts?.providerIds).toEqual([PROVIDER]));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ type: "email", config: { emails: "me@example.com" } });
    expect(JSON.stringify(d.get())).not.toContain("me@example.com");
  });

  it("refuses to save a channel when another tab switched the active project", async () => {
    activeProject = "22222222-2222-4222-8222-222222222222";
    render(<AlertsStep {...makeStepProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    expect(await screen.findByText("Project changed in another tab")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-enables the buttons and shows an error when a test or save request is rejected by the network", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    render(<AlertsStep {...makeStepProps({ userEmail: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /Slack/ }));
    fireEvent.change(screen.getByLabelText("Incoming webhook URL"), { target: { value: "https://hooks.slack.com/services/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText(/The test failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    expect(await screen.findByText(/Could not save the channel/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save channel" })).toBeEnabled();
  });

  it("tests a channel and shows the failure", async () => {
    fetchMock.mockImplementation(() => json({ success: false, error: "Slack rejected it" }, 400));
    render(<AlertsStep {...makeStepProps({ userEmail: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /Slack/ }));
    fireEvent.change(screen.getByLabelText("Incoming webhook URL"), { target: { value: "https://hooks.slack.com/services/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Slack rejected it")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/notification-providers/test");
  });

  it("applies a webhook preset to the saved config", async () => {
    fetchMock.mockImplementation(() => json({ id: PROVIDER }, 201));
    render(<AlertsStep {...makeStepProps({ userEmail: null })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Webhook/ }));
    pick("Service", /pagerduty/i);
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://events.pagerduty.com/v2/enqueue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).config).toMatchObject({ preset: "pagerduty", method: "POST" });
  });

  it("shows a save error and lists already saved channels by name", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) =>
      init?.method === "POST" ? json({ error: "Limit reached" }, 400) : json([{ id: PROVIDER, name: "Email", type: "email" }, { id: "other", name: "Skip me", type: "slack" }]),
    );
    render(<AlertsStep {...makeStepProps({ draft: { alerts: { providerIds: [PROVIDER] } } })} />);
    expect(await screen.findByText("Email")).toBeTruthy();
    expect(screen.queryByText("Skip me")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Telegram/ }));
    fireEvent.change(screen.getByLabelText("Bot token"), { target: { value: "t" } });
    fireEvent.change(screen.getByLabelText("Chat ID"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    expect(await screen.findByText("Limit reached")).toBeTruthy();
  });

  it("falls back to a count when saved channels cannot be loaded, and hides forms without permission", async () => {
    fetchMock.mockImplementation(() => json({}, 500));
    const response = makeResponse();
    render(<AlertsStep {...makeStepProps({ draft: { alerts: { providerIds: [PROVIDER] } }, permissions: { ...response.permissions, canCreateNotification: false } })} />);
    expect(await screen.findByText("1 saved channel(s)")).toBeTruthy();
    expect(screen.getByText(/do not have permission to add channels/)).toBeTruthy();
  });
});

describe("MonitorsStep", () => {
  const withApp = (extra: Partial<SetupDraft> = {}): SetupDraft => ({ app: { url: "https://app.example.com/" }, ...extra });

  it("hides the heartbeat, AI endpoint and MCP cards when their flags are off", () => {
    render(<MonitorsStep {...makeStepProps({ features: { ...FEATURES, heartbeat: false, aiEndpoint: false, mcpMonitor: false } })} />);
    expect(screen.queryByTestId("setup-card-heartbeat")).toBeNull();
    expect(screen.queryByTestId("setup-card-ai-endpoint")).toBeNull();
    expect(screen.queryByTestId("setup-card-mcp")).toBeNull();
  });

  it("ticks the homepage on first visit and lets the user add and remove pages", () => {
    const d = drafting(withApp());
    const { rerender } = render(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    expect(d.get().monitors?.pages).toEqual([{ url: "https://app.example.com/", name: "app.example.com" }]);
    rerender(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.change(screen.getByLabelText("Add a page path"), { target: { value: "pricing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    expect(d.get().monitors?.pages.map((p) => p.url)).toEqual(["https://app.example.com/", "https://app.example.com/pricing"]);
    rerender(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(d.get().monitors?.pages).toHaveLength(1);
    pick("Check every", "10 min");
    expect(d.get().monitors?.frequencyMinutes).toBe(10);
  });

  it("rejects an empty path and says what to do without an app URL", () => {
    const d = drafting(withApp({ monitors: { pages: [] } }));
    const { rerender } = render(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    expect(screen.getByText("Enter a path like /pricing.")).toBeTruthy();
    rerender(<MonitorsStep {...makeStepProps()} />);
    expect(screen.getByText(/Add your app URL in the first step/)).toBeTruthy();
  });

  it("shows the plan cap and warns when the picks exceed it", () => {
    const draft = withApp({ monitors: { pages: [{ url: "https://app.example.com/", name: "a" }, { url: "https://app.example.com/b", name: "b" }] } });
    const response = makeResponse({ monitorsRemaining: 1 });
    render(<MonitorsStep {...makeStepProps({ response, draft })} />);
    expect(screen.getByTestId("setup-monitor-cap").textContent).toMatch(/allows 1 more monitor\. You picked 2/);
  });

  it("saves a valid heartbeat, AI endpoint and MCP card, and drops invalid or switched-off ones", () => {
    const d = drafting(withApp({ monitors: { pages: [] } }));
    const view = () => <MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />;
    const { rerender } = render(view());

    fireEvent.click(screen.getByLabelText("Have a cron job or worker? Add a heartbeat"));
    expect(d.get().monitors?.heartbeat).toEqual({ name: "Nightly job", frequencyMinutes: 60 });
    fireEvent.change(screen.getByLabelText("Name", { selector: "#setup-hb-name" }), { target: { value: "Backup" } });
    fireEvent.change(screen.getByLabelText("Expect a ping every (minutes)"), { target: { value: "0" } });
    expect(d.get().monitors?.heartbeat).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Expect a ping every (minutes)"), { target: { value: "15" } });
    expect(d.get().monitors?.heartbeat).toEqual({ name: "Backup", frequencyMinutes: 15 });
    fireEvent.click(screen.getByLabelText("Have a cron job or worker? Add a heartbeat"));
    expect(d.get().monitors?.heartbeat).toBeUndefined();

    fireEvent.click(screen.getByLabelText("Monitor an AI endpoint"));
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://api.example.com/v1/chat/completions" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-4o-mini" } });
    expect(d.get().monitors?.aiEndpoint).toBeUndefined();
    fireEvent.change(screen.getByLabelText("API key secret name"), { target: { value: "openai_key" } });
    expect(d.get().monitors?.aiEndpoint).toMatchObject({ model: "gpt-4o-mini", secretKey: "OPENAI_KEY" });
    fireEvent.click(screen.getByLabelText("Monitor an AI endpoint"));
    expect(d.get().monitors?.aiEndpoint).toBeUndefined();

    fireEvent.click(screen.getByLabelText("Monitor an MCP server"));
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://mcp.example.com/mcp" } });
    expect(d.get().monitors?.mcpMonitor).toEqual({ name: "MCP server", url: "https://mcp.example.com/mcp" });
    fireEvent.change(screen.getByLabelText("Token secret name (optional)"), { target: { value: "bad" } });
    expect(d.get().monitors?.mcpMonitor).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Token secret name (optional)"), { target: { value: "mcp_token" } });
    expect(d.get().monitors?.mcpMonitor?.secretKey).toBe("MCP_TOKEN");
    fireEvent.click(screen.getByLabelText("Monitor an MCP server"));
    expect(d.get().monitors?.mcpMonitor).toBeUndefined();
    rerender(view());
  });
});

describe("AppStep", () => {
  it("stores a stripped URL only once it is valid", () => {
    const d = drafting();
    render(<AppStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    const input = screen.getByLabelText("App URL");
    fireEvent.change(input, { target: { value: "not a url" } });
    fireEvent.blur(input);
    expect(screen.getByText("Enter a full http or https address.")).toBeTruthy();
    expect(d.get().app).toBeUndefined();
    fireEvent.change(input, { target: { value: "https://user:pw@app.example.com/x?token=1#f" } });
    expect(d.get().app?.url).toBe("https://app.example.com/x");
    fireEvent.change(input, { target: { value: "" } });
    expect(d.get().app?.url).toBeUndefined();
  });

  it("saves the test account as project secrets and keeps only the secret name in the draft", async () => {
    fetchMock.mockImplementation(() => json({ id: "v-1" }, 201));
    const d = drafting();
    render(<AppStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "qa-user" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    await waitFor(() => expect(d.get().app?.testAccountSecret).toBe("SETUP_TEST_PASS"));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/variables", "/api/variables"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ key: "SETUP_TEST_PASS", value: "hunter2", isSecret: true });
    expect(JSON.stringify(d.get())).not.toContain("hunter2");
  });

  it("does not show an existing secret as saved", async () => {
    fetchMock.mockImplementation(() => json({ error: "Variable with this key already exists" }, 409));
    const d = drafting();
    render(<AppStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText(/already exists\. Use it as it is/)).toBeTruthy();
    expect(d.get().app?.testAccountSecret).toBeUndefined();
    // Reusing the existing secret records only its name, and nothing was overwritten.
    fireEvent.click(screen.getByRole("button", { name: "Use the existing secret" }));
    expect(d.get().app?.testAccountSecret).toBe("SETUP_TEST_PASS");
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "POST")).toBe(true);
  });

  it("updates the secret it created when the username changes after a partial failure", async () => {
    let passwordAttempts = 0;
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") return json({}, 200);
      const key = JSON.parse(init?.body as string).key;
      if (key === "SETUP_TEST_PASS" && ++passwordAttempts === 1) return json({ error: "Server error" }, 500);
      return json({ id: `id-${key}` }, 201);
    });
    render(<AppStep {...makeStepProps()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "first" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText("Server error")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init.method === "PUT");
    expect(put?.[0]).toBe("/api/variables/id-SETUP_TEST_USER");
    expect(JSON.parse(put?.[1].body)).toEqual({ value: "second" });
  });

  it("refuses to save secrets when another tab switched the active project", async () => {
    activeProject = "22222222-2222-4222-8222-222222222222";
    render(<AppStep {...makeStepProps()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText("Project changed in another tab")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an API error when saving the test account fails", async () => {
    fetchMock.mockImplementation(() => json({ error: "Variable name must be at least 4 characters" }, 400));
    render(<AppStep {...makeStepProps()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText("Variable name must be at least 4 characters")).toBeTruthy();
  });

  it("continues with the failed secret on retry instead of stopping at the one it already created", async () => {
    let passwordAttempts = 0;
    fetchMock.mockImplementation((_url: string, init?: { body?: string }) => {
      const key = JSON.parse(init?.body as string).key;
      if (key === "SETUP_TEST_PASS" && ++passwordAttempts === 1) return json({ error: "Server error" }, 500);
      return json({ id: "v-1" }, 201);
    });
    const d = drafting();
    render(<AppStep {...makeStepProps({ patchDraft: d.patchDraft })} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "qa-user" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText("Server error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    await waitFor(() => expect(d.get().app?.testAccountSecret).toBe("SETUP_TEST_PASS"));
    // user once, password twice: the username is not posted again (it would 409).
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).key)).toEqual(["SETUP_TEST_USER", "SETUP_TEST_PASS", "SETUP_TEST_PASS"]);
  });

  it("re-enables Save and shows an error when the request is rejected by the network", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("offline")));
    render(<AppStep {...makeStepProps()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    expect(await screen.findByText(/Could not save the test account/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save test account" })).toBeEnabled();
  });

  it("sends the setup project so the server can refuse a switched project", async () => {
    fetchMock.mockImplementation(() => json({ id: "v-1" }, 201));
    render(<AppStep {...makeStepProps()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "u" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test account" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].headers["x-supercheck-project-id"]).toBe(PROJECT_ID);
  });

  it("shows a saved test account instead of the form", () => {
    render(<AppStep {...makeStepProps({ draft: { app: { testAccountSecret: "SETUP_TEST_PASS" } } })} />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByText(/Saved as the project secrets/)).toBeTruthy();
  });
});

describe("StatusPageStep", () => {
  it("defaults the name, stores publish and lists components from the monitors step", () => {
    const d = drafting({ monitors: { pages: [{ url: "https://app.example.com/", name: "app.example.com" }], heartbeat: { name: "Nightly", frequencyMinutes: 5 } } });
    render(<StatusPageStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Web App status");
    expect(screen.getByText("app.example.com")).toBeTruthy();
    expect(screen.getByText("Nightly")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Publish now"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme" } });
    expect(d.get().statusPage).toMatchObject({ publish: true, name: "Acme" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
    expect(d.get().statusPage?.name).toBeUndefined();
  });

  it("sets the opt-out flag and hides the form", () => {
    const props = makeStepProps();
    const { rerender } = render(<StatusPageStep {...props} />);
    expect(screen.getByText(/No monitors picked/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("I don't need a status page"));
    expect(props.setStatusPageOptOut).toHaveBeenCalledWith(true);
    rerender(<StatusPageStep {...makeStepProps({ draft: { statusPage: { optOut: true } } })} />);
    expect(screen.getByText(/No status page for this project/)).toBeTruthy();
    expect(screen.queryByLabelText("Publish now")).toBeNull();
  });

  it("is disabled with a reason without permission", () => {
    const response = makeResponse();
    render(<StatusPageStep {...makeStepProps({ permissions: { ...response.permissions, canCreateStatusPage: false } })} />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByText(/do not have permission to create status pages/)).toBeTruthy();
  });
});

describe("DeveloperStep and InviteStep", () => {
  it("lists the real CLI commands and the recipe link only when its flag is on", () => {
    const { rerender } = render(<DeveloperStep {...makeStepProps()} />);
    for (const command of ["npx supercheck login --json", "npx supercheck init --skip-examples", "npx supercheck onboard --json", "npx supercheck deploy --dry-run --json"]) {
      expect(screen.getByText(command)).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: /coding-agent recipe/ }).getAttribute("href")).toBe("https://supercheck.io/docs/cli/after-ship-check");
    rerender(<DeveloperStep {...makeStepProps({ features: { ...FEATURES, codingRecipe: false } })} />);
    expect(screen.queryByRole("link", { name: /coding-agent recipe/ })).toBeNull();
  });

  it("links to members for admins and asks an org admin otherwise", () => {
    const { rerender } = render(<InviteStep {...makeStepProps()} />);
    expect(screen.getByRole("link", { name: "Invite people" }).getAttribute("href")).toBe("/org-admin?tab=members");
    const response = makeResponse();
    rerender(<InviteStep {...makeStepProps({ permissions: { ...response.permissions, canInvite: false } })} />);
    expect(screen.queryByRole("link", { name: "Invite people" })).toBeNull();
    expect(screen.getByText(/Ask an org admin/)).toBeTruthy();
  });
});

describe("responseError", () => {
  it("prefers error, then message, then the fallback", () => {
    expect(responseError({ error: "a", message: "b" }, "c")).toBe("a");
    expect(responseError({ message: "b" }, "c")).toBe("b");
    expect(responseError(null, "c")).toBe("c");
  });
});

describe("scan in the app and monitors steps", () => {
  const scan = {
    finalUrl: "https://app.example.com/",
    reachable: true,
    status: 200,
    redirects: 0,
    responseMs: 90,
    ssl: null,
    pages: [
      { path: "/", status: 200, ms: 1, title: null },
      { path: "/pricing", status: 200, ms: 1, title: null },
      { path: "/broken", status: 500, ms: 1, title: null },
      { path: "/v1/chat/completions", status: 405, ms: 1, title: null },
    ],
  };
  const withScan = { ...scan, pages: scan.pages.filter((p) => p.path !== "/v1/chat/completions") };

  it("app step starts a scan for the entered URL and hands the result up", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : json({ status: "done", result: withScan })));
    const setScan = jest.fn();
    render(<AppStep {...makeStepProps({ draft: { app: { url: "https://app.example.com/" } }, setScan })} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100);
    });
    expect(setScan).toHaveBeenCalledWith(withScan);
    jest.useRealTimers();
  });

  it("monitors step suggests scanned pages (status < 400, homepage ticked only) and keeps manual add", () => {
    const d = drafting({ app: { url: "https://app.example.com/" } });
    const props = () => makeStepProps({ scan: withScan, patchDraft: d.patchDraft, draft: d.get() });
    const { rerender } = render(<MonitorsStep {...props()} />);
    rerender(<MonitorsStep {...props()} />);
    expect(screen.getByLabelText(/app.example.com\/pricing/)).not.toBeChecked();
    expect(screen.queryByLabelText(/broken/)).toBeNull();
    expect(screen.getByLabelText(/^app.example.com\s*Website/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/app.example.com\/pricing/));
    expect(d.get().monitors?.pages.map((p) => p.url)).toContain("https://app.example.com/pricing");
    expect(screen.getByLabelText("Add a page path")).toBeTruthy();
  });

  it("monitors step ignores failed pages (status 0) and a scan of another host", () => {
    const failed = { ...scan, pages: [...scan.pages, { path: "/timed-out", status: 0, ms: 0, title: null }] };
    const view = render(<MonitorsStep {...makeStepProps({ scan: failed, draft: { app: { url: "https://app.example.com/" }, monitors: { pages: [] } } })} />);
    expect(screen.getByLabelText(/app.example.com\/pricing/)).toBeTruthy();
    expect(screen.queryByLabelText(/timed-out/)).toBeNull();
    view.unmount();
    render(<MonitorsStep {...makeStepProps({ scan: failed, draft: { app: { url: "https://other.example/" }, monitors: { pages: [] } } })} />);
    expect(screen.queryByLabelText(/pricing/)).toBeNull();
  });

  it("monitors step caps scanned suggestions at 10", () => {
    const many = { ...scan, pages: Array.from({ length: 15 }, (_, i) => ({ path: `/p${i}`, status: 200, ms: 1, title: null })) };
    render(<MonitorsStep {...makeStepProps({ scan: many, draft: { app: { url: "https://app.example.com/" }, monitors: { pages: [{ url: "https://app.example.com/", name: "app.example.com" }] } } })} />);
    expect(screen.getAllByRole("checkbox").length).toBe(11);
  });

  it("opens the AI endpoint card prefilled when the scan found an OpenAI-compatible path", () => {
    render(<MonitorsStep {...makeStepProps({ scan, draft: { app: { url: "https://app.example.com/" } } })} />);
    expect(screen.getByTestId("setup-card-ai-endpoint").textContent).toContain("found an OpenAI-compatible path");
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("https://app.example.com/v1/chat/completions");
  });

  it("builds suggestions and the AI endpoint URL from the scan's final origin after a redirect", () => {
    const redirected = { ...scan, finalUrl: "https://www.example.com/", redirects: 1 };
    render(<MonitorsStep {...makeStepProps({ scan: redirected, draft: { app: { url: "https://example.com/" }, monitors: { pages: [] } } })} />);
    expect(screen.getByLabelText(/www.example.com\/pricing/)).toBeTruthy();
    expect(screen.queryByLabelText(/^example.com\/pricing/)).toBeNull();
    expect(screen.getByLabelText("Endpoint URL")).toHaveValue("https://www.example.com/v1/chat/completions");
  });

  it("leaves the AI endpoint card closed without such a path", () => {
    render(<MonitorsStep {...makeStepProps({ scan: withScan, draft: { app: { url: "https://app.example.com/" } } })} />);
    expect(screen.queryByLabelText("Endpoint URL")).toBeNull();
  });
});

describe("review fixes in the steps", () => {
  const home = { url: "https://app.example.com/", name: "app.example.com" };

  it("names a channel by what it is, never by its token or webhook path", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => (init?.method === "POST" ? json({ id: PROVIDER }, 201) : json({})));
    render(<AlertsStep {...makeStepProps({ userEmail: "me@example.com" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe("Email – me@example.com");
    expect(channelName({ type: "webhook", label: "Webhook" }, { url: "https://hooks.example.com/secret/token" })).toBe("Webhook – hooks.example.com");
    expect(channelName({ type: "telegram", label: "Telegram" }, { botToken: "123:abc", chatId: "9" })).toBe("Telegram – setup");
  });

  it("stops adding channels at ten, and shows the lock message instead of a permission message on a read-only tab", () => {
    fetchMock.mockImplementation(() => json([]));
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`);
    const { rerender } = render(<AlertsStep {...makeStepProps({ draft: { alerts: { providerIds: ids } } })} />);
    expect(screen.getByText(/You have 10 channels/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Slack" })).toBeNull();
    rerender(<AlertsStep {...makeStepProps({ readOnly: true })} />);
    expect(screen.getByText(/Setup is running somewhere else/)).toBeTruthy();
    expect(screen.queryByText(/do not have permission to add channels/)).toBeNull();
  });

  it("blocks a 21st page and shows an inline error for an over-long path", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({ url: `https://app.example.com/p${i}`, name: `p${i}` }));
    const full = render(<MonitorsStep {...makeStepProps({ draft: { app: { url: "https://app.example.com/" }, monitors: { pages } } })} />);
    expect(screen.getByRole("button", { name: "Add page" })).toBeDisabled();
    full.unmount();
    const d = drafting({ app: { url: "https://app.example.com/" }, monitors: { pages: [home] } });
    render(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.change(screen.getByLabelText("Add a page path"), { target: { value: `/${"a".repeat(300)}` } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    expect(d.get().monitors?.pages).toHaveLength(1);
    expect(screen.getByText(/too long or not valid/)).toBeTruthy();
  });

  it("rejects reserved secret names, http MCP URLs and keeps api-version on the AI URL", () => {
    const d = drafting({ monitors: { pages: [] } });
    render(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.click(screen.getByLabelText("Monitor an AI endpoint"));
    fireEvent.change(screen.getByLabelText("Endpoint URL"), { target: { value: "https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-02-01&key=abc" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-4o" } });
    fireEvent.change(screen.getByLabelText("API key secret name"), { target: { value: "port" } });
    expect(screen.getByText("Cannot use system reserved variable names")).toBeTruthy();
    expect(d.get().monitors?.aiEndpoint).toBeUndefined();
    fireEvent.change(screen.getByLabelText("API key secret name"), { target: { value: "AZURE_KEY" } });
    expect(d.get().monitors?.aiEndpoint?.url).toBe("https://x.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-02-01");
    fireEvent.click(screen.getByLabelText("Monitor an MCP server"));
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://mcp.example.com/mcp" } });
    expect(screen.getByText("Must be an https URL")).toBeTruthy();
    expect(d.get().monitors?.mcpMonitor).toBeUndefined();
  });

  it("offers only the intervals the plan allows", () => {
    const response = makeResponse({ minIntervalMinutes: 5 });
    render(<MonitorsStep {...makeStepProps({ response, draft: { app: { url: "https://app.example.com/" }, monitors: { pages: [home], frequencyMinutes: 1 } } })} />);
    fireEvent.keyDown(screen.getByLabelText("Check every"), { key: "Enter" });
    expect(screen.queryByRole("option", { name: "1 min" })).toBeNull();
    expect(screen.getByRole("option", { name: "5 min" })).toBeTruthy();
  });

  it("moves suggested pages onto a changed app URL", () => {
    const d = drafting({ app: { url: "https://new.example.com/" }, monitors: { pages: [home, { url: "https://app.example.com/pricing", name: "app.example.com/pricing" }] } });
    render(<MonitorsStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    expect(d.get().monitors?.pages.map((p) => p.url)).toEqual(["https://new.example.com/", "https://new.example.com/pricing"]);
  });

  it("rewrites stale pages once and does not patch again on re-render", () => {
    const d = drafting({ app: { url: "https://new.example.com/" }, monitors: { pages: [home] } });
    const patch = jest.fn(d.patchDraft);
    const view = () => <MonitorsStep {...makeStepProps({ patchDraft: patch, draft: d.get() })} />;
    const { rerender } = render(view());
    expect(d.get().monitors?.pages.map((p) => p.url)).toEqual(["https://new.example.com/"]);
    const calls = patch.mock.calls.length;
    rerender(view());
    expect(patch).toHaveBeenCalledTimes(calls);
  });

  it("makes every card input read-only on a read-only tab and states the cap copy truthfully", () => {
    const draft = { app: { url: "https://app.example.com/" }, monitors: { pages: [home], heartbeat: { name: "hb", frequencyMinutes: 5 }, aiEndpoint: { name: "AI", url: "https://a.example.com/v1", model: "m", secretKey: "OPENAI_KEY" }, mcpMonitor: { name: "MCP", url: "https://m.example.com/mcp" } } };
    render(<MonitorsStep {...makeStepProps({ readOnly: true, draft, response: makeResponse({ monitorsRemaining: 1 }) })} />);
    for (const label of ["Expect a ping every (minutes)", "Endpoint URL", "Model", "API key secret name", "Server URL"]) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByTestId("setup-monitor-cap").textContent).toMatch(/Create continues/);
  });

  it("shows no plan cap when it is unknown", () => {
    render(<MonitorsStep {...makeStepProps({ response: makeResponse({ monitorsRemaining: null }) })} />);
    expect(screen.queryByTestId("setup-monitor-cap")).toBeNull();
  });

  it("does not refill a cleared status page name", () => {
    const d = drafting({ statusPage: { name: "Acme" } });
    const { rerender } = render(<StatusPageStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    rerender(<StatusPageStep {...makeStepProps({ patchDraft: d.patchDraft, draft: d.get() })} />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/A name is required/)).toBeTruthy();
  });
});
