import { render, screen } from "@testing-library/react";

jest.mock("@/components/page-breadcrumbs", () => ({
  PageBreadcrumbs: ({ items }: { items: { label: string }[] }) => <nav>{items.map((i) => i.label).join(" / ")}</nav>,
}));
jest.mock("@/components/connected-apps/connected-apps", () => ({ ConnectedApps: () => <div>apps list</div> }));

import ConnectedAppsPage, { dynamic } from "./page";

describe("Connected apps page", () => {
  it("explains what a connection is and shows the list under a breadcrumb", () => {
    render(<ConnectedAppsPage />);
    expect(screen.getByRole("navigation")).toHaveTextContent("Home / Connected apps");
    expect(screen.getByText(/AI agents and other apps you have allowed to read a project over MCP/i)).toBeInTheDocument();
    expect(screen.getByText("apps list")).toBeInTheDocument();
  });

  it("is rendered per request, not prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
