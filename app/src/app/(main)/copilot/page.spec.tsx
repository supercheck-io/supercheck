/** @jest-environment node */
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mockFindIncident = jest.fn();
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ organizationId: "org-1", project: { id: "project-1" } })),
}));
jest.mock("@/utils/db", () => ({ db: { query: { sreIncidents: { findFirst: (...a: unknown[]) => mockFindIncident(...a) } } } }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
jest.mock("@/components/sre/sre-copilot-page-client", () => ({ SreCopilotPageClient: () => null }));

import SreAiPage from "./page";

const incidentId = "018f0000-0000-7000-8000-000000000099";
const render = (incident?: string) => SreAiPage({ searchParams: Promise.resolve({ incident }) });
const clientProps = async (incident?: string) => {
  const tree = (await render(incident)) as { props: { children: Array<{ props: Record<string, unknown> }> } };
  return tree.props.children[1].props;
};

beforeEach(() => mockFindIncident.mockReset());

it("renders the general Copilot without an incident lookup", async () => {
  expect(await clientProps()).toEqual({ initialIncidentId: null });
  expect(mockFindIncident).not.toHaveBeenCalled();
});

it("scopes the chat to an incident of the current project", async () => {
  mockFindIncident.mockResolvedValue({ id: incidentId });
  expect(await clientProps(incidentId)).toEqual({ initialIncidentId: incidentId });
  const { where } = mockFindIncident.mock.calls[0][0] as { where: SQL };
  expect(new PgDialect().sqlToQuery(where).params).toEqual([incidentId, "org-1", "project-1"]);
});

it("returns 404 for a missing or foreign incident", async () => {
  mockFindIncident.mockResolvedValue(undefined);
  await expect(render(incidentId)).rejects.toThrow("NEXT_NOT_FOUND");
});

it("returns 404 for a malformed incident id before any lookup", async () => {
  await expect(render("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockFindIncident).not.toHaveBeenCalled();
});
