import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrialLoadTesting } from "./trial-load-testing";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));
import { toast } from "sonner";

const trialStatus = {
  isActive: false,
  plan: null,
  trial: {
    active: true,
    expiresAt: "2026-11-15T00:00:00.000Z",
    daysRemaining: 9,
  },
};
const domain = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  hostname: "app.example.com",
  verifiedAt: null,
  verifiedUntil: null,
  txtName: "_supercheck-load-test.app.example.com",
  txtValue: "supercheck-load-test=proof",
  ...overrides,
});

let domains: ReturnType<typeof domain>[] = [];
const fetchMock = jest.fn();

function respond(url: string, init?: RequestInit) {
  const json = (body: unknown, ok = true) =>
    Promise.resolve({ ok, json: async () => body });
  if (url === "/api/subscription/status") return json(trialStatus);
  if (url === "/api/execution/target-domains" && !init)
    return json({ data: domains });
  if (url === "/api/execution/target-domains") return json({ success: true });
  if (url === "/api/execution/trial-workload")
    return json({ script: "export default function () {}" });
  return json({}, false);
}

function renderCard(canManage = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TrialLoadTesting canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  domains = [];
  fetchMock.mockImplementation(respond);
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

const callsTo = (url: string) =>
  fetchMock.mock.calls.filter((call) => call[0] === url);

describe("TrialLoadTesting", () => {
  it("is shown to an admin during an active trial", async () => {
    renderCard();
    expect(
      await screen.findByText("Load testing during your trial"),
    ).toBeVisible();
    expect(await screen.findByText("No domains yet.")).toBeVisible();
  });

  it("is hidden from members who cannot manage the organization, without calling the registry", async () => {
    const { container } = renderCard(false);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/subscription/status"),
    );
    expect(container).toBeEmptyDOMElement();
    expect(callsTo("/api/execution/target-domains")).toHaveLength(0);
  });

  it.each([
    ["a paid organization", { isActive: true, plan: "plus", trial: null }],
    [
      "an organization whose trial ended",
      {
        isActive: false,
        plan: null,
        trial: {
          active: false,
          expiresAt: "2026-11-01T00:00:00.000Z",
          daysRemaining: 0,
        },
      },
    ],
    [
      "an organization that never had a trial",
      { isActive: false, plan: null, trial: null },
    ],
  ])("is hidden for %s", async (_label, status) => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/subscription/status"
        ? Promise.resolve({ ok: true, json: async () => status })
        : respond(url, init),
    );
    const { container } = renderCard();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/subscription/status"),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("registers a domain and shows the TXT record to publish", async () => {
    renderCard();
    fireEvent.change(await screen.findByLabelText("Domain"), {
      target: { value: " app.example.com " },
    });
    domains = [domain()];
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));
    await waitFor(() =>
      expect(
        JSON.parse(
          callsTo("/api/execution/target-domains").find((call) => call[1])![1]
            .body,
        ),
      ).toEqual({ action: "register", hostname: "app.example.com" }),
    );
    expect(
      await screen.findByText("_supercheck-load-test.app.example.com"),
    ).toBeVisible();
    expect(screen.getByText("supercheck-load-test=proof")).toBeVisible();
    expect(screen.getByText("Not verified")).toBeVisible();
    expect(toast.success).toHaveBeenCalledWith("Domain added");
  });

  it("does not submit an empty domain", async () => {
    renderCard();
    await screen.findByLabelText("Domain");
    expect(screen.getByRole("button", { name: "Add domain" })).toBeDisabled();
  });

  it("verifies and removes a domain by id", async () => {
    domains = [domain()];
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Domain verified"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Domain removed"),
    );
    const bodies = callsTo("/api/execution/target-domains")
      .filter((call) => call[1])
      .map((call) => JSON.parse(call[1].body));
    expect(bodies).toEqual([
      { action: "verify", id: domain().id },
      { action: "remove", id: domain().id },
    ]);
  });

  it("shows a verified domain without the DNS instructions", async () => {
    domains = [domain({ verifiedAt: "2026-11-01T00:00:00.000Z" })];
    renderCard();
    expect(await screen.findByText("Verified")).toBeVisible();
    expect(screen.getByRole("button", { name: "Re-verify" })).toBeVisible();
    expect(
      screen.queryByText("supercheck-load-test=proof"),
    ).not.toBeInTheDocument();
  });

  it("reports the server's reason when a domain cannot be verified", async () => {
    domains = [domain()];
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init
        ? Promise.resolve({
            ok: false,
            json: async () => ({
              error: "DNS ownership or public address verification failed",
            }),
          })
        : respond(url, init),
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Verify" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "DNS ownership or public address verification failed",
      ),
    );
  });

  it("generates a script from the URL, users and duration, and copies it", async () => {
    renderCard();
    fireEvent.change(await screen.findByLabelText("HTTPS URL"), {
      target: { value: "https://app.example.com/health" },
    });
    fireEvent.change(screen.getByLabelText("Users (1 to 5)"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Seconds (up to 300)"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    expect(
      await screen.findByLabelText("Generated k6 script"),
    ).toHaveTextContent("export default function");
    expect(
      JSON.parse(callsTo("/api/execution/trial-workload")[0][1].body),
    ).toEqual({
      url: "https://app.example.com/health",
      vus: 3,
      durationSeconds: 90,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy script" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "export default function () {}",
      ),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("does not generate a script without a URL", async () => {
    renderCard();
    await screen.findByLabelText("HTTPS URL");
    expect(
      screen.getByRole("button", { name: "Generate script" }),
    ).toBeDisabled();
  });

  it("explains a rejected workload instead of showing a script", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/execution/trial-workload"
        ? Promise.resolve({
            ok: false,
            json: async () => ({
              error: "An organization-verified execution target is required",
            }),
          })
        : respond(url, init),
    );
    renderCard();
    fireEvent.change(await screen.findByLabelText("HTTPS URL"), {
      target: { value: "https://other.example/health" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "An organization-verified execution target is required",
      ),
    );
    expect(
      screen.queryByLabelText("Generated k6 script"),
    ).not.toBeInTheDocument();
  });
});
