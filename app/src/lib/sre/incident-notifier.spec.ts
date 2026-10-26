/** @jest-environment node */

const selectQueue: unknown[][] = [];
function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "leftJoin", "innerJoin"]) node[name] = jest.fn(() => node);
  node.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  return node;
}
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(() => chain(selectQueue.shift() ?? [])) } }));

const redisSet = jest.fn();
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => ({ set: redisSet })) }));
const sendEmailToMultiple = jest.fn().mockResolvedValue({ sentCount: 1, failedAddresses: [], errors: {} });
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmailToMultiple }) } }));
const fetchPublicEndpoint = jest.fn().mockResolvedValue({ ok: true });
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({ fetchPublicEndpoint: (...args: unknown[]) => fetchPublicEndpoint(...args) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: jest.fn() }) }));

import { buildIncidentUrl, notifyIncidentEvent } from "./incident-notifier";

const base = {
  organizationId: "org-1",
  projectId: "project-1",
  incidentId: "inc-1",
  event: "assigned" as const,
  actorUserId: "actor",
  assigneeUserId: "assignee",
};
const incident = { id: "inc-1", number: 7, title: "Checkout down", severity: "sev2", status: "triggered", assigneeUserId: "assignee", serviceName: "checkout-api" };

beforeEach(() => {
  jest.clearAllMocks();
  selectQueue.length = 0;
  redisSet.mockResolvedValue("OK");
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
});

it("builds a link back to the incident page", () => {
  expect(buildIncidentUrl("inc-1")).toBe("https://app.example.com/incidents/inc-1");
});

it("sends nothing when the same incident event was already announced", async () => {
  redisSet.mockResolvedValue(null);
  await notifyIncidentEvent(base);
  expect(redisSet).toHaveBeenCalledWith(expect.stringContaining("inc-1:assigned"), "1", "EX", 600, "NX");
  expect(sendEmailToMultiple).not.toHaveBeenCalled();
  expect(fetchPublicEndpoint).not.toHaveBeenCalled();
});

it("emails the new assignee directly with a link, without raw evidence", async () => {
  selectQueue.push([incident], [{ email: "ada@example.com" }], []);
  await notifyIncidentEvent({ ...base, detail: "Root cause: bad deploy" });
  expect(sendEmailToMultiple).toHaveBeenCalledTimes(1);
  const mail = sendEmailToMultiple.mock.calls[0][0];
  expect(mail.recipients).toEqual(["ada@example.com"]);
  expect(mail.text).toContain("https://app.example.com/incidents/inc-1");
  expect(mail.text).toContain("Incident #7 assigned");
});

it("does not email the actor about their own assignment", async () => {
  selectQueue.push([incident], []);
  await notifyIncidentEvent({ ...base, assigneeUserId: "actor" });
  expect(sendEmailToMultiple).not.toHaveBeenCalled();
});

it("posts to providers linked to the triggering monitor and skips invalid configs", async () => {
  selectQueue.push(
    [incident],
    [{ sourceType: "monitor", sourceId: "mon-1" }],
    [
      { id: "p1", type: "slack", config: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } },
      { id: "p2", type: "slack", config: { webhookUrl: "http://169.254.169.254/latest" } },
    ],
  );
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  const [url, init] = fetchPublicEndpoint.mock.calls[0];
  expect(url).toBe("https://hooks.slack.com/services/T/B/x");
  expect(JSON.parse(init.body).text).toContain("https://app.example.com/incidents/inc-1");
});

it("sends no provider messages for manual incidents (no trigger alert)", async () => {
  selectQueue.push([incident], []);
  await notifyIncidentEvent({ ...base, event: "acknowledged", assigneeUserId: null });
  expect(fetchPublicEndpoint).not.toHaveBeenCalled();
});

it("never throws when delivery fails", async () => {
  fetchPublicEndpoint.mockRejectedValueOnce(new Error("boom"));
  selectQueue.push([incident], [{ sourceType: "job", sourceId: "job-1" }], [{ id: "p1", type: "discord", config: { discordWebhookUrl: "https://discord.com/api/webhooks/1/x" } }]);
  await expect(notifyIncidentEvent({ ...base, event: "created", assigneeUserId: null })).resolves.toBeUndefined();
});

it("fails open on dedupe when Redis is unavailable", async () => {
  redisSet.mockRejectedValue(new Error("redis down"));
  selectQueue.push([incident], []);
  await notifyIncidentEvent({ ...base, event: "created", assigneeUserId: null });
  expect(selectQueue).toHaveLength(0);
});
