import { toOverviewMonitor } from "./overview-monitor";

it("uses the linked monitor's interval and creation date in the Overview row", () => {
  const createdAt = new Date("2024-04-03T12:00:00.000Z");
  const monitor = {
    id: "monitor-id",
    name: "API",
    type: "http_request",
    status: "up",
    target: "https://example.com",
    frequencyMinutes: 1,
    enabled: false,
    createdAt: createdAt.toISOString(),
    updatedAt: "2024-04-04T12:00:00.000Z",
  };

  expect(toOverviewMonitor(monitor, "API component")).toEqual(
    expect.objectContaining({
      frequencyMinutes: 1,
      enabled: false,
      createdAt: createdAt.toISOString(),
      componentName: "API component",
    }),
  );
});
