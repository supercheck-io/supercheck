import { fireEvent, render, screen } from "@testing-library/react";

import type { SreServiceListItem } from "@/actions/sre-services";

import { ServiceCatalog } from "./service-catalog";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/actions/sre-services", () => ({
  archiveSreService: jest.fn(),
}));

jest.mock("@/components/sre/services/service-form-dialog", () => ({
  ServiceFormDialog: () => null,
}));

const service: SreServiceListItem = {
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
  createdAt: new Date("2026-07-10T12:00:00Z"),
  updatedAt: new Date("2026-07-10T12:00:00Z"),
};

describe("ServiceCatalog", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("defaults to read-only controls", () => {
    render(<ServiceCatalog initialServices={[service]} loadError={null} />);
    expect(screen.queryByRole("button", { name: "Add service" })).not.toBeInTheDocument();
  });

  it("allows authorized creation", () => {
    render(<ServiceCatalog initialServices={[]} loadError={null} permissions={{ canCreate: true, canUpdate: true, canArchive: false }} />);
    expect(screen.getByRole("button", { name: "Add service" })).toBeInTheDocument();
  });

  it("opens the service detail page from pointer and keyboard row selection", async () => {
    render(<ServiceCatalog initialServices={[service]} loadError={null} />);

    const serviceName = await screen.findByText("checkout-api");
    const row = serviceName.closest("tr")!;
    expect(row).not.toHaveClass("h-[72px]");
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledWith(`/services/${service.id}`);

    mockPush.mockClear();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith(`/services/${service.id}`);
  });
});
