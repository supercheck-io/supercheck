import { fireEvent, render, screen } from "@testing-library/react";

import type { SreServiceListItem } from "@/actions/sre-services";

import { ServiceCatalog } from "./service-catalog";

const mockPush = jest.fn();

// Radix/cmdk use browser layout APIs that jsdom does not provide.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

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

  it("keeps table-backed filters and search clearing working", async () => {
    render(
      <ServiceCatalog
        initialServices={[
          service,
          {
            ...service,
            id: "other",
            name: "inventory-api",
            tier: "2",
            status: "deprecated",
          },
        ]}
        loadError={null}
      />,
    );
    await screen.findByText("checkout-api");
    fireEvent.click(
      screen.getByRole("button", { name: "Tier", expanded: false }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Tier 1/ }));
    expect(screen.getByText("checkout-api")).toBeInTheDocument();
    expect(screen.queryByText("inventory-api")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Clear filters" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", { name: "Status", expanded: false }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Deprecated/ }));
    expect(screen.getByText("inventory-api")).toBeInTheDocument();
    expect(screen.queryByText("checkout-api")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Clear filters" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search services" }), {
      target: { value: "inventory" },
    });
    expect(screen.queryByText("checkout-api")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear service search" }),
    );
    expect(screen.getByText("checkout-api")).toBeInTheDocument();
  });

  it("searches the fields advertised by the toolbar and sorts service names", async () => {
    render(
      <ServiceCatalog
        initialServices={[
          {
            ...service,
            name: "z-checkout",
            ownerTeam: "payments",
            tags: ["critical"],
            description: "Customer checkout",
          },
          {
            ...service,
            id: "other",
            name: "a-inventory",
            ownerTeam: "warehouse",
            tags: ["stock"],
            description: "Stock service",
          },
        ]}
        loadError={null}
      />,
    );
    await screen.findByText("z-checkout");
    const search = screen.getByRole("textbox", { name: "Search services" });
    for (const value of ["payments", "critical", "Customer checkout"]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByText("z-checkout")).toBeInTheDocument();
      expect(screen.queryByText("a-inventory")).not.toBeInTheDocument();
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Clear service search" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Service" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("a-inventory");
  });

  it("defaults to read-only controls", () => {
    render(<ServiceCatalog initialServices={[service]} loadError={null} />);
    expect(
      screen.queryByRole("button", { name: "Add service" }),
    ).not.toBeInTheDocument();
  });

  it("allows authorized creation", () => {
    render(
      <ServiceCatalog
        initialServices={[]}
        loadError={null}
        permissions={{ canCreate: true, canUpdate: true, canArchive: false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add service" }),
    ).toBeInTheDocument();
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
