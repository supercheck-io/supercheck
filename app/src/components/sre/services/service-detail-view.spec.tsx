import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  approveSreTopologySuggestion,
  rejectSreTopologySuggestion,
  getSreServiceDetail,
  type SreServiceDetail,
} from "@/actions/sre-services";
import { ServiceDetailView } from "./service-detail-view";

jest.mock("@/actions/sre-services", () => ({
  addSreServiceResource: jest.fn(),
  approveSreTopologySuggestion: jest.fn(),
  getSreServiceDetail: jest.fn(),
  rejectSreTopologySuggestion: jest.fn(),
  removeSreServiceDependency: jest.fn(),
  removeSreServiceResource: jest.fn(),
  saveSreServiceDependency: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));

function detailFixture(
  overrides: Partial<SreServiceDetail> = {},
): SreServiceDetail {
  const now = new Date("2026-07-10T12:00:00Z");
  return {
    service: {
      id: "018f0000-0000-7000-8000-000000000001",
      name: "checkout-api",
      description: "Checkout service",
      tier: "1",
      environment: "production",
      ownerTeam: "payments",
      ownerUserId: null,
      repoUrl: null,
      otelServiceName: "checkout-api",
      slackChannel: null,
      status: "active",
      tags: ["payments"],
      createdAt: now,
      updatedAt: now,
    },
    services: [
      {
        id: "018f0000-0000-7000-8000-000000000001",
        name: "checkout-api",
        status: "active",
      },
      {
        id: "018f0000-0000-7000-8000-000000000002",
        name: "payments-db",
        status: "active",
      },
    ],
    dependencies: [],
    resources: [],
    resourceCandidates: [],
    suggestions: [
      {
        id: "018f0000-0000-7000-8000-000000000003",
        source: "trace-discovery",
        confidence: 0.82,
        sourceServiceId: "018f0000-0000-7000-8000-000000000001",
        sourceServiceName: "checkout-api",
        targetServiceId: "018f0000-0000-7000-8000-000000000002",
        targetServiceName: "payments-db",
        status: "pending",
        createdAt: now,
      },
    ],
    health: {
      health: "unknown",
      score: null,
      stale: false,
      calculatedAt: now,
      explanation: "No fresh health snapshot is available.",
      activeIncidentCount: 0,
      firingAlertCount: 0,
    },
    recentIncidents: [],
    recentAlerts: [],
    recentDeployments: [],
    permissions: { canEdit: false, canConfigure: false },
    ...overrides,
  };
}

describe("ServiceDetailView", () => {
  it.each(["approve", "reject"])(
    "retains %s and review history inside Dependencies",
    async (action) => {
      const initial = detailFixture({
        permissions: { canEdit: true, canConfigure: true },
      });
      const operation =
        action === "approve"
          ? approveSreTopologySuggestion
          : rejectSreTopologySuggestion;
      jest
        .mocked(operation)
        .mockResolvedValue({ success: true, message: "Updated" });
      jest
        .mocked(getSreServiceDetail)
        .mockResolvedValue({
          success: true,
          detail: {
            ...initial,
            suggestions: [
              {
                ...initial.suggestions[0],
                status: action === "approve" ? "approved" : "rejected",
              },
            ],
          },
        });
      render(<ServiceDetailView initialDetail={initial} />);
      expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByText("No recent incidents")).toBeInTheDocument();
      expect(screen.getByText("No alerts are linked to this service.")).toBeInTheDocument();
      expect(screen.getByText(/GitHub or GitLab connectors/)).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole("tab", { name: /Dependencies/ }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByText("Suggested dependencies (1 pending)"));
      fireEvent.click(
        screen.getByRole("button", {
          name: action === "approve" ? "Approve" : "Reject",
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByText(action === "approve" ? "approved" : "rejected"),
        ).toBeInTheDocument(),
      );
      expect(operation).toHaveBeenCalledWith({ id: initial.suggestions[0].id });
      expect(
        screen.queryByRole("button", { name: "Approve" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Reject" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps topology mutations hidden from read-only viewers", () => {
    render(<ServiceDetailView initialDetail={detailFixture()} />);

    expect(
      screen.queryByRole("button", { name: /add dependency/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Dependencies/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Topology" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Health score:", { exact: false }),
    ).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Dependencies/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByText("Suggested dependencies (1 pending)"));
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Configure access required")).toBeInTheDocument();
  });

  it("shows incident status, alert status and signal counts", () => {
    const when = new Date("2026-07-10T12:00:00Z");
    render(
      <ServiceDetailView
        initialDetail={detailFixture({
          health: {
            health: "failing",
            score: 0,
            stale: false,
            calculatedAt: when,
            explanation: "1 firing alert is linked to this service; at least one is SEV1 or SEV2.",
            activeIncidentCount: 0,
            firingAlertCount: 1,
          },
          recentIncidents: [
            { id: "inc-1", incidentNumber: 7, title: "Checkout down", severity: "sev2", status: "resolved", acknowledgedAt: when, updatedAt: when },
            { id: "inc-2", incidentNumber: 8, title: "Checkout slow", severity: "sev1", status: "triggered", acknowledgedAt: null, updatedAt: when },
          ],
          recentAlerts: [
            { id: "alert-1", title: "Checkout monitor down", severity: "sev2", status: "firing", firedAt: when },
          ],
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "Back to services" })).toHaveAttribute("href", "/services");
    expect(screen.getByRole("heading", { level: 2, name: /Service health/ })).toBeInTheDocument();
    expect(screen.getByText("Firing alerts").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Active incidents").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: /#7.*Checkout down.*Resolved/ })).toHaveAttribute("href", "/incidents/inc-1");
    expect(screen.getByRole("link", { name: /#8.*Checkout slow.*Triggered/ })).toBeInTheDocument();
    expect(screen.getByText("firing")).toBeInTheDocument();
    // Owner and calculated time are inline rows in the side column, not behind a toggle.
    expect(screen.getByText("Owner").nextElementSibling).toHaveTextContent("payments");
    expect(screen.getByRole("complementary", { name: "Service overview" })).toBeInTheDocument();
  });

  it("shows tier and environment pills, section hints outside headings, and collapses long side lists", () => {
    const when = new Date("2026-07-10T12:00:00Z");
    render(
      <ServiceDetailView
        initialDetail={detailFixture({
          health: {
            health: "failing",
            score: 0,
            stale: false,
            calculatedAt: when,
            explanation: "1 firing alert is linked to this service.",
            activeIncidentCount: 0,
            firingAlertCount: 1,
          },
          recentAlerts: Array.from({ length: 7 }, (_, index) => ({
            id: `alert-${index}`,
            title: `Alert ${index}`,
            severity: "sev3" as const,
            status: "resolved",
            firedAt: when,
          })),
        })}
      />,
    );

    expect(screen.getByText("Tier 1")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About recent incidents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^Recent incidents/ })).not.toHaveTextContent("About");
    // A live alert overrides health with a placeholder score, so no score row.
    expect(screen.queryByText("Health score")).not.toBeInTheDocument();
    expect(screen.queryByText("Alert 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(screen.getByText("Alert 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a snapshot health score when no live signal overrides it", () => {
    const base = detailFixture();
    render(<ServiceDetailView initialDetail={{ ...base, health: { ...base.health, health: "healthy", score: 0.92 } }} />);
    expect(screen.getByText("Health score").nextElementSibling).toHaveTextContent("92%");
  });

  it("links only http(s) repository URLs", () => {
    const base = detailFixture();
    const { unmount } = render(
      <ServiceDetailView initialDetail={{ ...base, service: { ...base.service, repoUrl: "https://github.com/acme/checkout" } }} />,
    );
    expect(screen.getByRole("link", { name: "github.com/acme/checkout" })).toHaveAttribute("href", "https://github.com/acme/checkout");
    unmount();
    render(
      <ServiceDetailView initialDetail={{ ...base, service: { ...base.service, repoUrl: "javascript:alert(1)" } }} />,
    );
    expect(screen.queryByRole("link", { name: /alert/ })).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("shows topology management actions with edit access", () => {
    render(
      <ServiceDetailView
        initialDetail={detailFixture({
          permissions: { canEdit: true, canConfigure: true },
        })}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Dependencies/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByRole("button", { name: /add dependency/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /suggestions/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Suggested dependencies (1 pending)"),
    ).toBeInTheDocument();
  });
});
