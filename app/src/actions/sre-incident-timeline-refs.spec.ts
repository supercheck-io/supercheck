/** @jest-environment node */
const ids = {
  user: "018f0000-0000-7000-8000-00000000000c",
  org: "018f0000-0000-7000-8000-00000000000a",
  project: "018f0000-0000-7000-8000-00000000000b",
  incident: "018f0000-0000-7000-8000-0000000000d1",
  other: "018f0000-0000-7000-8000-0000000000e2",
  alert: "018f0000-0000-7000-8000-0000000000f3",
};
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: async () => ({ userId: ids.user, organizationId: ids.org, project: { id: ids.project } }),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn() }) }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ MAX_INCIDENT_UPDATE_LENGTH: 2000, MAX_RESOLUTION_SUMMARY_LENGTH: 2000 }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({}));

const selectRows = (rows: unknown[]) =>
  Object.assign(Promise.resolve(rows), {
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  });
const select = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }));

import { getSreIncidentTimeline } from "./sre-incident-lifecycle";

it("resolves user names and alert titles referenced by timeline events", async () => {
  select
    .mockReturnValueOnce(selectRows([{ id: ids.incident }]))
    .mockReturnValueOnce(
      selectRows([
        { id: "e1", eventType: "state_change", eventData: { state: "assigned", previousAssigneeUserId: ids.other, assigneeUserId: ids.user } },
        { id: "e2", eventType: "state_change", eventData: { state: "alert_correlated", alertEventId: ids.alert } },
      ]),
    )
    .mockReturnValueOnce(selectRows([{ id: ids.user, name: "Ada" }, { id: ids.other, name: "Grace" }]))
    .mockReturnValueOnce(selectRows([{ id: ids.alert, title: "API latency high" }]));
  const result = await getSreIncidentTimeline(ids.incident);
  expect(result.success && result.refs).toEqual({
    users: { [ids.user]: "Ada", [ids.other]: "Grace" },
    alerts: { [ids.alert]: "API latency high" },
  });
});
