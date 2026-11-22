import { render, screen } from "@testing-library/react";
import { PublicIncidentDetail } from "./public-incident-detail";

jest.mock("./use-status-page-favicon", () => ({ useStatusPageFavicon: jest.fn() }));
jest.mock("./subscribe-dialog", () => ({ SubscribeDialog: ({ incident }: { incident?: { name: string } }) => <span>subscribe to {incident?.name}</span> }));

it("renders the maintenance window of a scheduled incident", () => {
  const incident = { id: "m1", name: "DB upgrade", status: "scheduled" as const, impact: "none" as const, createdAt: new Date(), resolvedAt: null, updates: [], scheduledFor: new Date("2030-01-05T02:00:00Z"), scheduledUntil: new Date("2030-01-05T04:00:00Z") };
  render(<PublicIncidentDetail incident={incident} idOrSubdomain="page" />);
  expect(screen.getByText(/Jan 5, 2030, 02:00 AM UTC.*04:00 AM UTC/)).toBeInTheDocument();
});

describe("follow this incident", () => {
  const open = { id: "i1", name: "Login errors", status: "investigating" as const, impact: "major" as const, createdAt: new Date(), resolvedAt: null, updates: [] };
  const settings = { id: "p1", name: "Acme", allowPageSubscribers: true, allowIncidentSubscribers: true, allowEmailSubscribers: true };

  it("offers Subscribe on an open incident of a public page that allows incident subscribers", () => {
    render(<PublicIncidentDetail incident={open} idOrSubdomain="page" subscription={settings} isPublicView />);
    expect(screen.getByText("subscribe to Login errors")).toBeInTheDocument();
  });

  it.each([
    ["resolved", { ...open, status: "resolved" as const, resolvedAt: new Date() }, settings],
    ["incident subscriptions off", open, { ...settings, allowIncidentSubscribers: false }],
    ["page subscriptions off", open, { ...settings, allowPageSubscribers: false }],
    ["the in-app preview", open, undefined],
  ])("hides it for %s", (_, incident, subscription) => {
    render(<PublicIncidentDetail incident={incident} idOrSubdomain="page" subscription={subscription} />);
    expect(screen.queryByText(/subscribe to/)).not.toBeInTheDocument();
  });
});
