import { render, screen } from "@testing-library/react";

import { SreIncidentsPageClient } from "./sre-incidents-page-client";

jest.mock("@/hooks/use-sre", () => ({ useSreIncidents: () => ({ isPending: true }) }));
jest.mock("@/components/sre/incidents/new-incident-action", () => ({ NewIncidentAction: () => null }));
jest.mock("@/components/sre/incidents/sre-incidents-list", () => ({ SreIncidentsList: () => null }));

it("shows only the incidents list, with no Alerts tab", () => {
  render(<SreIncidentsPageClient />);
  expect(screen.getByRole("heading", { name: "Incidents" })).toBeInTheDocument();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.getByRole("link", { name: /Trends/ })).toHaveAttribute("href", "/incidents/analytics");
});
