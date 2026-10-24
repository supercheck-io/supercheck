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

const fetchMock = jest.fn();

function respond(url: string, init?: RequestInit) {
  const json = (body: unknown, ok = true) =>
    Promise.resolve({ ok, json: async () => body });
  if (url === "/api/subscription/status") return json(trialStatus);
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
  fetchMock.mockImplementation(respond);
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});

const callsTo = (url: string) =>
  fetchMock.mock.calls.filter((call) => call[0] === url);

describe("TrialLoadTesting", () => {
  it("is shown to an admin during an active trial without a domain section", async () => {
    renderCard();
    expect(await screen.findByText("Trial load testing")).toBeVisible();
    expect(screen.queryByLabelText("Domain")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add domain" }),
    ).not.toBeInTheDocument();
    expect(callsTo("/api/execution/target-domains")).toHaveLength(0);
  });

  it("is hidden from members who cannot manage the organization", async () => {
    const { container } = renderCard(false);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/subscription/status"),
    );
    expect(container).toBeEmptyDOMElement();
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
              error: "HTTP workload exceeds the trial VU or remaining duration limit",
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
        "HTTP workload exceeds the trial VU or remaining duration limit",
      ),
    );
    expect(
      screen.queryByLabelText("Generated k6 script"),
    ).not.toBeInTheDocument();
  });
});
