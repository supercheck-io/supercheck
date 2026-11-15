
describe("uptimeResults", () => {
  it("drops maintenance rows as well as superseded synthetic rows", () => {
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
    const { uptimeResults, excludeMaintenanceResults } = jest.requireActual("./monitor-result-filters") as typeof import("./monitor-result-filters");
    const query = new PgDialect().sqlToQuery(uptimeResults).sql;
    expect(query).toContain('"in_maintenance" IS NOT TRUE');
    expect(query).toContain("sibling.execution_group_id");
    expect(new PgDialect().sqlToQuery(excludeMaintenanceResults).sql).toBe('"monitor_results"."in_maintenance" IS NOT TRUE');
  });
});
