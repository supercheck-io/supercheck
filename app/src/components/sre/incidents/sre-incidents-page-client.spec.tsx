import { render, screen } from "@testing-library/react";

import { SreIncidentsPageClient } from "./sre-incidents-page-client";

jest.mock("@/hooks/use-sre", () => ({
  useSreIncidents: () => ({
    isPending: false,
    data: { success: true, incidents: [], currentUserId: "u1", truncated: false, hasIncidents: true },
  }),
}));
jest.mock("@/components/sre/incidents/new-incident-action", () => ({ NewIncidentAction: () => null }));
jest.mock("@/components/sre/incidents/sre-incidents-list", () => ({ SreIncidentsList: () => <div>incidents-list</div> }));

it("shows only the incidents list, with no Alerts tab", () => {
  render(<SreIncidentsPageClient />);
  expect(screen.getByRole("heading", { name: "Incidents" })).toBeInTheDocument();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.getByText("incidents-list")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Trends/ })).toHaveAttribute("href", "/incidents/analytics");
});
