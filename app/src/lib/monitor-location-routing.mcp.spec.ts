jest.mock("@/utils/db", () => ({ db: {} }));
import { getMonitorWorkload } from "./monitor-location-routing";

describe("getMonitorWorkload", () => {
  it("routes MCP monitors to the monitor workload and only synthetic tests to the browser", () => {
    expect(getMonitorWorkload("mcp_server")).toBe("monitor");
    expect(getMonitorWorkload("synthetic_test")).toBe("browser");
  });
});
