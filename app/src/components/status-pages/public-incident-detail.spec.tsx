import { render, screen } from "@testing-library/react";
import { PublicIncidentDetail } from "./public-incident-detail";

jest.mock("./use-status-page-favicon", () => ({ useStatusPageFavicon: jest.fn() }));

it("renders the maintenance window of a scheduled incident", () => {
  const incident = { id: "m1", name: "DB upgrade", status: "scheduled" as const, impact: "none" as const, createdAt: new Date(), resolvedAt: null, updates: [], scheduledFor: new Date("2030-01-05T02:00:00Z"), scheduledUntil: new Date("2030-01-05T04:00:00Z") };
  render(<PublicIncidentDetail incident={incident} idOrSubdomain="page" />);
  expect(screen.getByText(/Jan 5, 2030, 02:00 AM UTC.*04:00 AM UTC/)).toBeInTheDocument();
});
