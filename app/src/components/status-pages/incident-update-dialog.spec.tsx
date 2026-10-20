import { incidentUpdateFormSchema } from "./incident-update-dialog";

jest.mock("@/actions/update-incident-status", () => ({
  updateIncidentStatus: jest.fn(),
}));

const base = {
  deliverNotifications: true,
  restoreComponentStatus: false,
  body: "A sufficiently long update body",
};

describe("incident update scheduled validation", () => {
  it("requires a maintenance window when the status is scheduled", () => {
    const result = incidentUpdateFormSchema.safeParse({
      ...base,
      status: "scheduled",
      scheduledFor: "",
      scheduledUntil: "",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "scheduledFor",
        "scheduledUntil",
      ]);
  });

  it("rejects a window that ends in the past", () => {
    const result = incidentUpdateFormSchema.safeParse({
      ...base,
      status: "scheduled",
      scheduledFor: "2020-01-01T10:00",
      scheduledUntil: "2020-01-01T11:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a future maintenance window", () => {
    const result = incidentUpdateFormSchema.safeParse({
      ...base,
      status: "scheduled",
      scheduledFor: "2099-01-01T10:00",
      scheduledUntil: "2099-01-01T11:00",
    });
    expect(result.success).toBe(true);
  });

  it("does not require a window for ordinary status updates", () => {
    expect(
      incidentUpdateFormSchema.safeParse({
        ...base,
        status: "monitoring",
        scheduledFor: "",
        scheduledUntil: "",
      }).success,
    ).toBe(true);
  });
});
