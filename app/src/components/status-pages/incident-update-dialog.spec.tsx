import { fireEvent, render, screen } from "@testing-library/react";
import { IncidentUpdateDialog, incidentUpdateFormSchema } from "./incident-update-dialog";

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

describe("restore components checkbox", () => {
  const renderDialog = (incident: Partial<Parameters<typeof IncidentUpdateDialog>[0]["incident"] & object>) =>
    render(
      <IncidentUpdateDialog
        open
        onOpenChange={jest.fn()}
        statusPageId="sp-1"
        onSuccess={jest.fn()}
        incident={{ id: "i-1", name: "Checkout slow", status: "investigating", affectedComponentsCount: 2, ...incident }}
      />,
    );
  const pickResolved = () => {
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Resolved" }));
  };

  it("is checked by default when resolving a post with affected components, and can be unchecked", () => {
    renderDialog({});
    pickResolved();
    const box = screen.getByRole("checkbox", { name: "Restore components to operational" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it("is unchecked on open for a post that is already resolved", () => {
    renderDialog({ status: "resolved" });
    expect(screen.getByRole("checkbox", { name: "Restore components to operational" })).not.toBeChecked();
  });

  it("defaults on again after switching away from Resolved and back", () => {
    renderDialog({});
    pickResolved();
    fireEvent.click(screen.getByRole("checkbox", { name: "Restore components to operational" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Monitoring" }));
    expect(screen.queryByRole("checkbox", { name: "Restore components to operational" })).not.toBeInTheDocument();
    pickResolved();
    expect(screen.getByRole("checkbox", { name: "Restore components to operational" })).toBeChecked();
  });

  it("stays unchecked when the post has no affected components", () => {
    renderDialog({ affectedComponentsCount: 0 });
    pickResolved();
    expect(screen.getByRole("checkbox", { name: "Restore components to operational" })).not.toBeChecked();
  });
});
