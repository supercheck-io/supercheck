import { displayMonitorType } from "./data";

describe("displayMonitorType", () => {
  it("shows an http_request monitor with an AI endpoint config as ai_endpoint", () => {
    expect(displayMonitorType({ type: "http_request", config: { aiEndpoint: { model: "m" } } })).toBe("ai_endpoint");
  });
  it("leaves every other monitor as stored", () => {
    expect(displayMonitorType({ type: "http_request", config: {} })).toBe("http_request");
    expect(displayMonitorType({ type: "http_request", config: null })).toBe("http_request");
    expect(displayMonitorType({ type: "website" })).toBe("website");
    expect(displayMonitorType({ type: "mcp_server", config: { aiEndpoint: {} } })).toBe("mcp_server");
  });
});
