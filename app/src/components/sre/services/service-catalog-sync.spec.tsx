import { fireEvent, render, screen } from "@testing-library/react";

import type { SreServiceListItem } from "@/actions/sre-services";

import { ServiceCatalog } from "./service-catalog";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/actions/sre-services", () => ({
  archiveSreService: jest.fn(),
}));

const created: SreServiceListItem = {
  id: "018f0000-0000-7000-8000-0000000000aa",
  name: "fresh-api",
  description: null,
  tier: "2",
  environment: null,
  ownerTeam: null,
  repoUrl: null,
  otelServiceName: null,
  slackChannel: null,
  status: "active",
  tags: [],
  createdAt: new Date("2026-11-02T10:00:00Z"),
  updatedAt: new Date("2026-11-02T10:00:00Z"),
};

jest.mock("@/components/sre/services/service-form-dialog", () => ({
  ServiceFormDialog: ({
    onSaved,
  }: {
    onSaved: (service: SreServiceListItem) => void;
  }) => <button onClick={() => onSaved(created)}>save-service</button>,
}));

const canCreate = { canCreate: true, canUpdate: true, canArchive: false };

describe("ServiceCatalog server payload sync", () => {
  it("keeps a saved service when a stale payload re-seeds a remounted catalog", async () => {
    const first = render(
      <ServiceCatalog
        projectId="project-a"
        initialServices={[]}
        loadError={null}
        permissions={canCreate}
      />,
    );
    fireEvent.click(screen.getByTestId("add-service-btn"));
    fireEvent.click(screen.getByText("save-service"));
    await screen.findByText("fresh-api");
    first.unmount();

    // revalidatePath triggers a remount whose payload predates the create.
    const second = render(
      <ServiceCatalog
        projectId="project-a"
        initialServices={[]}
        loadError={null}
        permissions={canCreate}
      />,
    );
    expect(await screen.findByText("fresh-api")).toBeInTheDocument();

    // Once the server payload includes the row, the local copy is dropped.
    second.rerender(
      <ServiceCatalog
        projectId="project-a"
        initialServices={[created]}
        loadError={null}
        permissions={canCreate}
      />,
    );
    expect(await screen.findByText("fresh-api")).toBeInTheDocument();
    second.unmount();
    render(
      <ServiceCatalog
        projectId="project-a"
        initialServices={[]}
        loadError={null}
        permissions={canCreate}
      />,
    );
    expect(screen.getByText("No services registered")).toBeInTheDocument();
  });
  it("never shows a pending save in another project", async () => {
    const first = render(
      <ServiceCatalog projectId="project-a" initialServices={[]} loadError={null} permissions={canCreate} />,
    );
    fireEvent.click(screen.getByTestId("add-service-btn"));
    fireEvent.click(screen.getByText("save-service"));
    await screen.findByText("fresh-api");
    first.unmount();

    render(
      <ServiceCatalog projectId="project-b" initialServices={[]} loadError={null} permissions={canCreate} />,
    );
    expect(screen.queryByText("fresh-api")).not.toBeInTheDocument();
    expect(screen.getByText("No services registered")).toBeInTheDocument();
  });
});
