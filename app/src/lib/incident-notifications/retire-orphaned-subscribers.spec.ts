/** @jest-environment node */
const where = jest.fn();
jest.mock("@/utils/db", () => ({
  db: { update: () => ({ set: () => ({ where: (w: unknown) => (where(w), Promise.resolve()) }) }) },
}));
import { PgDialect } from "drizzle-orm/pg-core";
import { retireOrphanedSubscribers } from "./retire-orphaned-subscribers";

const render = () => new PgDialect().sqlToQuery(where.mock.calls[0][0]);

it("targets subscribers whose only scope row is the component", async () => {
  await retireOrphanedSubscribers({ componentId: "c1" });
  const { sql: text, params } = render();
  expect(text).toContain("status_page_component_subscriptions");
  expect(text).toMatch(/not exists[\s\S]*<> \$\d[\s\S]*not exists[\s\S]*status_page_incident_subscriptions/);
  expect(params).toContain("c1");
});

it("targets subscribers whose only scope row is the incident", async () => {
  where.mockClear();
  await retireOrphanedSubscribers({ incidentId: "i1" });
  const { sql: text, params } = render();
  expect(text).toMatch(/not exists[\s\S]*<> \$\d[\s\S]*not exists[\s\S]*status_page_component_subscriptions/);
  expect(params).toContain("i1");
});
