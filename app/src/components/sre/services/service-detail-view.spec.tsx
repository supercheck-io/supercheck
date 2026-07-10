import { render, screen } from "@testing-library/react";

import type { SreServiceDetail } from "@/actions/sre-services";
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
  useQueryClient: () => ({ setQueryData: jest.fn() }),
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
  it("keeps topology mutations hidden from read-only viewers", () => {
    render(<ServiceDetailView initialDetail={detailFixture()} />);

    expect(
      screen.queryByRole("button", { name: /add dependency/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Dependencies" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Topology" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: "Investigation Map" })
        .querySelector(".lucide-brain-circuit"),
    ).toBeInTheDocument();
  });

  it("shows topology management actions with edit access", () => {
    render(
      <ServiceDetailView
        initialDetail={detailFixture({
          permissions: { canEdit: true, canConfigure: true },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: /add dependency/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /suggestions/i }),
    ).toBeInTheDocument();
  });
});
