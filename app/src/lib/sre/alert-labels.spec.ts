import { alertIncidentTitle, getAlertTypeLabel } from "./alert-labels";

describe("alert labels", () => {
  it("names the SSL notices", () => {
    expect(getAlertTypeLabel("ssl_expiring")).toBe("SSL expiring");
    expect(getAlertTypeLabel("ssl_renewed")).toBe("SSL renewed");
    expect(alertIncidentTitle("Checkout", "ssl_renewed")).toBe("Checkout: SSL renewed");
  });
  it("title-cases an unknown type", () => {
    expect(getAlertTypeLabel("some_new_type")).toBe("Some New Type");
  });
});
