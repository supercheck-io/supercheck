
describe("uptimeResults", () => {
  it("drops maintenance rows as well as superseded synthetic rows", () => {
    const { PgDialect } = jest.requireActual("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
    const { uptimeResults, excludeMaintenanceResults } = jest.requireActual("./monitor-result-filters") as typeof import("./monitor-result-filters");
    const query = new PgDialect().sqlToQuery(uptimeResults).sql;
    expect(query).toContain('"in_maintenance" IS NOT TRUE');
    expect(query).toContain("sibling.execution_group_id");
    // A cycle with any region inside a window is dropped whole.
    expect(new PgDialect().sqlToQuery(excludeMaintenanceResults).sql).toMatch(/muted\.execution_group_id = "monitor_results"\."execution_group_id"\s+AND muted\.in_maintenance/);
  });
});
