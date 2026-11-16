import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { makeStepProps, PROJECT_ID } from "../test-fixtures";
import { ReviewStep, type ReviewStepProps } from "./review-step";

jest.mock("@/actions/create-component", () => ({ createComponent: jest.fn(async () => ({ success: true, component: { id: "c1" } })) }));
jest.mock("@/actions/create-status-page", () => ({ createStatusPage: jest.fn(async () => ({ success: true, statusPage: { id: "sp1" } })) }));
jest.mock("@/actions/get-components", () => ({ getComponents: jest.fn(async () => ({ success: true, components: [] })) }));
jest.mock("@/actions/get-status-pages", () => ({ getStatusPages: jest.fn(async () => ({ success: true, statusPages: [{ id: "sp-old", name: "Old" }] })) }));
jest.mock("@/actions/publish-status-page", () => ({ publishStatusPage: jest.fn(async () => ({ success: true })) }));
jest.mock("@/actions/notification-policy", () => ({
  getProjectNotificationPolicy: jest.fn(async () => ({ success: true, data: { policy: { channelIds: [], emailServiceOwnersOnSev12: false, renotifyMax: 3, escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null, autoInvestigateOnOpen: false } } })),
  saveProjectNotificationPolicy: jest.fn(async () => ({ success: true })),
}));

jest.mock("@/actions/requirements", () => ({
  findRequirementsForSetup: jest.fn(async () => ({ success: true, requirements: [] })),
  createRequirement: jest.fn(async () => ({ id: "req-1", success: true })),
}));
jest.mock("@/actions/sre-services", () => ({
  getSreServices: jest.fn(async () => ({ success: true, services: [] })),
  createSreService: jest.fn(async () => ({ success: true, service: { id: "svc-1" }, message: "ok" })),
}));

const actions = {
  createComponent: (jest.requireMock("@/actions/create-component") as { createComponent: jest.Mock }).createComponent,
  save: (jest.requireMock("@/actions/notification-policy") as { saveProjectNotificationPolicy: jest.Mock }).saveProjectNotificationPolicy,
};

const PROVIDER = "00000000-0000-4000-8000-000000000001";
const fetchMock = jest.fn();
let monitorPost: (body: { type: string }) => { ok: boolean; status: number; json: () => Promise<unknown> };
let seq = 0;

beforeEach(() => {
  seq = 0;
  fetchMock.mockReset();
  actions.createComponent.mockClear();
  actions.save.mockClear();
  monitorPost = (body) => ({ ok: true, status: 201, json: async () => ({ id: `m${++seq}`, ...(body.type === "heartbeat" ? { heartbeat: { pingUrl: "https://ping.example/secret" } } : {}) }) });
  fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === "/api/context") return { ok: true, status: 200, json: async () => ({ project: { id: PROJECT_ID } }) };
    if (url.startsWith("/api/monitors?")) return { ok: true, status: 200, json: async () => ({ data: [], pagination: { hasNextPage: false } }) };
    if (url === "/api/monitors" && init?.method === "POST") return monitorPost(JSON.parse(init.body as string));
    return { ok: false, status: 404, json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function setup(over: Partial<ReviewStepProps> = {}) {
  const created: Record<string, string> = {};
  const props: ReviewStepProps = {
    ...makeStepProps({
      draft: {
        app: { testAccountSecret: "SETUP_TEST_PASS" },
        alerts: { providerIds: [PROVIDER], repeatUntilAck: { enabled: true, repeatMinutes: 10 } },
        monitors: { pages: [{ url: "https://app.example.com/", name: "app.example.com" }], heartbeat: { name: "Nightly", frequencyMinutes: 60 } },
        statusPage: { name: "Acme status", publish: true },
      },
    }),
    skipped: ["tests" as const],
    recordCreated: jest.fn(async (key: string, id: string) => void (created[key] = id)),
    getCreated: () => created,
    complete: jest.fn(async () => true),
    completed: false,
    ...over,
  };
  return { props, ...render(<ReviewStep {...props} />) };
}

describe("ReviewStep", () => {
  it("lists what is already saved, what will be created and what was skipped", () => {
    setup();
    expect(screen.getByText("Already saved")).toBeTruthy();
    expect(screen.getByText("1 alert channel")).toBeTruthy();
    expect(screen.getByText("Test account secrets")).toBeTruthy();
    expect(screen.getByText("Will be created")).toBeTruthy();
    expect(screen.getByTestId("setup-create-item-0").textContent).toContain("app.example.com");
    expect(screen.getByText(/Skipped: Requirements and tests/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create 6 items" })).toBeTruthy();
  });

  it("creates every item with per-item progress and shows the heartbeat ping URL once", async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create 6 items" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish setup" })).toBeTruthy());
    expect(screen.getByTestId("setup-ping-url").textContent).toContain("https://ping.example/secret");
    expect(screen.getByRole("button", { name: "Copy ping URL" })).toBeTruthy();
    expect(screen.getAllByText("Created").length).toBe(6);
    expect(actions.createComponent).toHaveBeenCalledTimes(2);
    expect(actions.save).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({ renotifyUnackedMinutes: 10 }));
    expect(JSON.stringify((props.recordCreated as jest.Mock).mock.calls)).not.toContain("ping.example");
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(props.complete).toHaveBeenCalled());
  });

  it("shows the error with Retry for a failed item and retries just that one", async () => {
    monitorPost = () => ({ ok: false, status: 400, json: async () => ({ error: "Monitor limit reached" }) });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Create 6 items" }));
    expect(await screen.findAllByText("Monitor limit reached")).toHaveLength(2);
    expect(screen.getByText(/2 items failed/)).toBeTruthy();
    monitorPost = () => ({ ok: true, status: 201, json: async () => ({ id: `m${++seq}` }) });
    expect(screen.getByRole("button", { name: "Retry app.example.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry app.example.com" }));
    await waitFor(() => expect(screen.getAllByText("Monitor limit reached")).toHaveLength(1));
  });

  it("reports an unreadable status page list instead of throwing", async () => {
    const getPages = (jest.requireMock("@/actions/get-status-pages") as { getStatusPages: jest.Mock }).getStatusPages;
    getPages.mockResolvedValueOnce({ success: false, error: "denied" });
    setup({ ...makeStepProps({ draft: { statusPage: { name: "Acme status" } } }) });
    fireEvent.click(screen.getByRole("button", { name: /^Create \d+ item/ }));
    expect(await screen.findByText("Could not read status pages")).toBeTruthy();
  });

  it("stops with a project-changed error", async () => {
    fetchMock.mockImplementation(async (url: string) => (url === "/api/context" ? { ok: true, status: 200, json: async () => ({ project: { id: "other" } }) } : { ok: true, status: 200, json: async () => ({}) }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Create 6 items" }));
    expect(await screen.findByText("Project changed in another tab")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("offers Finish when nothing is left to create", () => {
    setup({ ...makeStepProps({ draft: {} }), skipped: ["app", "alerts", "monitors", "statusPage"] });
    expect(screen.getByText(/Nothing to create/)).toBeTruthy();
    expect(screen.queryByText("Already saved")).toBeNull();
    expect(screen.getByRole("button", { name: "Finish setup" })).toBeTruthy();
  });

  it("pluralises a single item and links to the dashboard when completed", () => {
    setup({ ...makeStepProps({ draft: { monitors: { pages: [{ url: "https://a.example.com/", name: "a" }] } } }), completed: true });
    expect(screen.getByText("Setup is finished.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to dashboard" }).getAttribute("href")).toBe("/");
  });

  it("shows Setup is finished only after the final save succeeded, else an error and a retry", async () => {
    const complete = jest.fn(async () => false);
    setup({ ...makeStepProps({ draft: {} }), skipped: ["app", "alerts", "monitors", "statusPage"], complete });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByText(/Could not save that setup is finished/)).toBeTruthy();
    expect(screen.queryByText("Setup is finished.")).toBeNull();
    complete.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(screen.queryByText(/Could not save that setup is finished/)).toBeNull());
  });

  it("says monitors are created without alerts when Alerts was skipped after saving a channel", () => {
    setup({ skipped: ["alerts"] });
    expect(screen.getByTestId("setup-skipped-alerts").textContent).toMatch(/without alerts because you skipped Alerts/);
  });

  it("disables Create for viewers with a reason", () => {
    setup({ readOnly: true });
    expect(screen.getByText(/You have view access/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create 6 items" })).toBeDisabled();
  });
});

describe("ReviewStep requirements and services", () => {
  it("creates requirements and a service, then offers Generate test and the jobs link", async () => {
    const { props } = setup({
      skipped: [],
      permissions: { ...makeStepProps().permissions, canConfigureConnectors: true },
      draft: { tests: { requirements: [{ title: "User can sign in", description: "d" }] }, aiSre: { connectorIds: [PROVIDER], services: [{ name: "app.example.com" }] } },
    });
    expect(screen.getByText("1 AI SRE connector")).toBeTruthy();
    expect(screen.queryByTestId("setup-jobs-link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create 2 items" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish setup" })).toBeTruthy());
    expect(screen.getByRole("link", { name: "Generate test for User can sign in" }).getAttribute("href")).toBe("/playground?scriptType=browser&requirementId=req-1");
    expect(screen.getByRole("link", { name: "Create a scheduled job or CI key" }).getAttribute("href")).toBe("/jobs/create");
    expect(props.recordCreated).toHaveBeenCalledWith(expect.stringMatching(/^requirement:[0-9a-z]+$/), "req-1");
  });
});
