import { render, screen } from "@testing-library/react";

import { ServiceFormDialog } from "./service-form-dialog";

const mockAssignees = jest.fn();
jest.mock("@/hooks/use-sre", () => ({ useSreIncidentAssignees: () => mockAssignees() }));
jest.mock("@/actions/sre-services", () => ({ createSreService: jest.fn(), updateSreService: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView = jest.fn();
  Element.prototype.hasPointerCapture = jest.fn();
});

const service = {
  id: "s1", name: "api", description: null, tier: "3", environment: null, ownerTeam: null,
  ownerUserId: "gone", repoUrl: null, otelServiceName: null, slackChannel: null, status: "active",
  tags: [], createdAt: new Date(), updatedAt: new Date(),
} as never;

describe("ServiceFormDialog stale owner", () => {
  it("shows a stored owner who is no longer eligible so it can be cleared", () => {
    mockAssignees.mockReturnValue({ data: { success: true, assignees: [{ id: "u2", name: "Ann", image: null }] } });
    render(<ServiceFormDialog open onOpenChange={() => {}} onSaved={() => {}} service={service} />);
    expect(screen.getAllByText("Current owner (no longer eligible)").length).toBeGreaterThan(0);
  });
  it("does not flag the owner while assignees are still loading", () => {
    mockAssignees.mockReturnValue({ data: undefined });
    render(<ServiceFormDialog open onOpenChange={() => {}} onSaved={() => {}} service={service} />);
    expect(screen.queryByText("Current owner (no longer eligible)")).toBeNull();
  });
});
