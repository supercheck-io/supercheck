import React from "react";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
// The form module pulls in the location map (ESM d3) and data hooks; validation needs none of them.
jest.mock("./location-config-section", () => ({ LocationConfigSection: () => null }));
jest.mock("@/components/shared/test-selector", () => ({ __esModule: true, default: () => null }));

import { formSchema, type FormValues } from "./monitor-form";
import { HeartbeatFields } from "./heartbeat-fields";

const heartbeat = (every: string, everyUnit: "minutes" | "hours" | "days", grace: string, graceUnit: "minutes" | "hours" | "days" = "minutes") => ({
  name: "Nightly backup",
  type: "heartbeat" as const,
  target: "",
  heartbeatConfig_every: every,
  heartbeatConfig_everyUnit: everyUnit,
  heartbeatConfig_grace: grace,
  heartbeatConfig_graceUnit: graceUnit,
});

const issuePaths = (values: Record<string, unknown>) => {
  const result = formSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("monitor form heartbeat validation", () => {
  it("accepts 1 minute to 31 days with a grace of 1 minute to 1 day, and needs no target", () => {
    expect(issuePaths(heartbeat("1", "minutes", "1"))).toEqual([]);
    expect(issuePaths(heartbeat("31", "days", "1", "days"))).toEqual([]);
    expect(issuePaths(heartbeat("44640", "minutes", "1440"))).toEqual([]);
  });

  it.each([
    ["0", "minutes"],
    ["44641", "minutes"],
    ["32", "days"],
    ["1.5", "hours"],
    ["", "hours"],
  ] as const)("rejects an interval of %s %s", (every, unit) => {
    expect(issuePaths(heartbeat(every, unit, "10"))).toEqual(["heartbeatConfig_every"]);
  });

  it.each([
    ["0", "minutes"],
    ["1441", "minutes"],
    ["2", "days"],
    ["25", "hours"],
  ] as const)("rejects a grace period of %s %s", (grace, unit) => {
    expect(issuePaths(heartbeat("1", "hours", grace, unit))).toEqual(["heartbeatConfig_grace"]);
  });

  it("still requires a target for other monitor types", () => {
    expect(issuePaths({ name: "Site", type: "http_request", target: "" })).toContain("target");
  });
});

function Harness({ editMode }: { editMode?: boolean }) {
  const form = useForm<FormValues>({ defaultValues: heartbeat("1", "hours", "12") as FormValues });
  return (
    <Form {...form}>
      <HeartbeatFields form={form} editMode={editMode} />
    </Form>
  );
}

describe("HeartbeatFields", () => {
  it("labels the interval and grace inputs with their units and help text", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Expect a ping every")).toHaveValue(1);
    expect(screen.getByLabelText("Grace period")).toHaveValue(12);
    expect(screen.getByRole("combobox", { name: "Expect a ping every unit" })).toHaveTextContent("hours");
    expect(screen.getByRole("combobox", { name: "Grace period unit" })).toHaveTextContent("minutes");
    expect(screen.getByText("How late a ping may be before the monitor goes down.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("The ping URL appears after you create the monitor.");
  });

  it("drops the create-only note when editing", () => {
    render(<Harness editMode />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
