/** @jest-environment node */

const selectQueue: unknown[][] = [];
function chain(result: unknown[]) {
  const node: Record<string, unknown> = {};
  for (const name of ["from", "where", "limit", "leftJoin", "innerJoin", "orderBy"]) node[name] = jest.fn(() => node);
  node.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  node.catch = () => node;
  return node;
}
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(() => chain(selectQueue.shift() ?? [])) } }));

const redisSet = jest.fn();
jest.mock("@/lib/queue", () => ({ getRedisConnection: jest.fn(async () => ({ set: redisSet })) }));
const sendEmailToMultiple = jest.fn().mockResolvedValue({ sentCount: 1, failedAddresses: [], errors: {} });
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmailToMultiple }) } }));
const fetchPublicEndpoint = jest.fn().mockResolvedValue({ ok: true });
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({ fetchPublicEndpoint: (...args: unknown[]) => fetchPublicEndpoint(...args) }));
jest.mock("@/lib/notification-providers/crypto", () => ({
  decryptNotificationProviderConfig: jest.fn((config: { envelope?: Record<string, unknown> }) => config.envelope ?? config),
}));
const renderIncidentUpdateEmail = jest.fn();
jest.mock("@/lib/email-renderer", () => ({ renderIncidentUpdateEmail: (...args: unknown[]) => renderIncidentUpdateEmail(...args) }));
const mockWarn = jest.fn();
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ warn: (...a: unknown[]) => mockWarn(...a) }) }));

let mockAssignable = [{ id: "assignee" }, { id: "actor" }, { id: "commander" }, { id: "previous" }];
jest.mock("./incident-lifecycle", () => ({ listAssignableUsers: jest.fn(async () => mockAssignable) }));

import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { buildIncidentUrl, notifyIncidentEvent } from "./incident-notifier";

const base = {
  organizationId: "org-1",
  projectId: "project-1",
  incidentId: "inc-1",
  event: "assigned" as const,
  actorUserId: "actor",
  assigneeUserId: "assignee",
};
const people = [
  { id: "assignee", name: "Ada", email: "ada@example.com" },
  { id: "actor", name: "Grace", email: "grace@example.com" },
];
const incident = { id: "inc-1", number: 7, title: "Checkout down", severity: "sev2", status: "triggered", assigneeUserId: "assignee", serviceName: "checkout-api" };

beforeEach(() => {
  jest.clearAllMocks();
  selectQueue.length = 0;
  mockAssignable = [{ id: "assignee" }, { id: "actor" }, { id: "commander" }, { id: "previous" }];
  redisSet.mockResolvedValue("OK");
  // Default: template fails, so the plain fallback email is what most tests check.
  renderIncidentUpdateEmail.mockRejectedValue(new Error("render unavailable"));
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
  selectQueue.push([incident], people, []);
  await notifyIncidentEvent({ ...base, detail: "Root cause: bad deploy" });
  expect(sendEmailToMultiple).toHaveBeenCalledTimes(1);
  const mail = sendEmailToMultiple.mock.calls[0][0];
  expect(mail.recipients).toEqual(["ada@example.com"]);
  expect(mail.text).toContain("https://app.example.com/incidents/inc-1");
  expect(mail.text).toContain("Incident #7 assigned");
  expect(mail.text).toContain("Owner: Ada");
  expect(mail.text).toContain("Updated by: Grace");
  expect(mail.subject).toBe("[SEV2] Incident assigned to Ada: #7 Checkout down");
});

it("renders the incident email template for direct email", async () => {
  renderIncidentUpdateEmail.mockResolvedValueOnce({ subject: "[SEV2] Incident assigned: #7 x", html: "<html>tpl</html>", text: "tpl" });
  selectQueue.push([incident], people, []);
  await notifyIncidentEvent({ ...base, detail: "Root cause: bad deploy" });
  expect(renderIncidentUpdateEmail).toHaveBeenCalledWith(
    expect.objectContaining({ event: "assigned", incidentNumber: 7, incidentUrl: "https://app.example.com/incidents/inc-1", detail: "Root cause: bad deploy", actorName: "Grace", assigneeName: "Ada" }),
  );
  expect(sendEmailToMultiple.mock.calls[0][0]).toEqual(
    expect.objectContaining({ recipients: ["ada@example.com"], subject: "[SEV2] Incident assigned: #7 x", html: "<html>tpl</html>" }),
  );
});

it("does not email the actor about their own assignment", async () => {
  selectQueue.push([incident], people, []);
  await notifyIncidentEvent({ ...base, assigneeUserId: "actor" });
  expect(sendEmailToMultiple).not.toHaveBeenCalled();
});

describe("participant emails", () => {
  const participants = [
    ...people,
    { id: "commander", name: "Lin", email: "lin@example.com" },
    { id: "previous", name: "Bo", email: "bo@example.com" },
  ];

  it("emails the owner and commander when someone else acknowledges", async () => {
    selectQueue.push([{ ...incident, commanderUserId: "commander" }], participants, []);
    await notifyIncidentEvent({ ...base, event: "acknowledged", assigneeUserId: null });
    expect(sendEmailToMultiple.mock.calls[0][0].recipients).toEqual(["ada@example.com", "lin@example.com"]);
  });

  it("tells the previous owner on a reassignment", async () => {
    selectQueue.push([incident], participants, []);
    await notifyIncidentEvent({ ...base, previousAssigneeUserId: "previous" });
    expect(sendEmailToMultiple.mock.calls[0][0].recipients).toEqual(["ada@example.com", "bo@example.com"]);
  });

  it("skips people who can no longer act on the incident", async () => {
    mockAssignable = [{ id: "actor" }];
    selectQueue.push([incident], participants, []);
    await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
    expect(sendEmailToMultiple).not.toHaveBeenCalled();
  });

  it("emails a participant about a flapping reopen at most once per window", async () => {
    redisSet.mockImplementation(async (key: string) => (key.includes("incident-email") ? null : "OK"));
    selectQueue.push([incident], participants, []);
    await notifyIncidentEvent({ ...base, event: "reopened", actorUserId: null, assigneeUserId: null });
    expect(redisSet).toHaveBeenCalledWith("supercheck:sre:incident-email:inc-1:reopened:assignee", "1", "EX", 600, "NX");
    expect(sendEmailToMultiple).not.toHaveBeenCalled();
  });
});

it("posts to providers linked to the triggering monitor and skips invalid configs", async () => {
  selectQueue.push(
    [incident],
    people,
    [{ sourceType: "monitor", sourceId: "mon-1" }],
    [
      { id: "p1", type: "slack", projectId: "project-1", config: { envelope: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } } },
      { id: "p2", type: "slack", projectId: "project-1", config: { envelope: { webhookUrl: "http://169.254.169.254/latest" } } },
    ],
  );
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  expect(decryptNotificationProviderConfig).toHaveBeenCalledWith(expect.anything(), "project-1");
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  const [url, init] = fetchPublicEndpoint.mock.calls[0];
  expect(url).toBe("https://hooks.slack.com/services/T/B/x");
  const body = JSON.parse(init.body);
  expect(body.text).toBe("Incident resolved by Grace: #7 Checkout down");
  expect(body.attachments[0]).toMatchObject({ title_link: "https://app.example.com/incidents/inc-1", footer: "Supercheck" });
  expect(body.attachments[0].fields).toEqual(expect.arrayContaining([{ title: "Owner", value: "Ada", short: true }]));
});

it("sends no provider messages for manual incidents (no trigger alert)", async () => {
  selectQueue.push([incident], people, []);
  await notifyIncidentEvent({ ...base, event: "acknowledged", assigneeUserId: null });
  expect(fetchPublicEndpoint).not.toHaveBeenCalled();
});

describe("chat payloads", () => {
  const source = [{ sourceType: "monitor", sourceId: "mon-1" }];
  const send = async (provider: Record<string, unknown>, title = "Checkout down") => {
    selectQueue.push([{ ...incident, title }], people, source, [{ id: "p1", projectId: "project-1", ...provider }]);
    await notifyIncidentEvent({ ...base, event: "acknowledged", assigneeUserId: null });
    return JSON.parse(fetchPublicEndpoint.mock.calls[0][1].body);
  };

  it("sends Teams an Adaptive Card with facts and an open button", async () => {
    const body = await send({ type: "teams", config: { envelope: { teamsWebhookUrl: "https://example.webhook.office.com/x" } } });
    const card = body.attachments[0];
    expect(card.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.content.body[0].text).toBe("Incident acknowledged by Grace");
    expect(card.content.body[3].facts).toEqual(expect.arrayContaining([{ title: "Severity", value: "SEV2 High" }]));
    expect(card.content.actions[0]).toMatchObject({ type: "Action.OpenUrl", url: "https://app.example.com/incidents/inc-1" });
  });

  it("sends Discord an embed that cannot mention everyone", async () => {
    const body = await send({ type: "discord", config: { envelope: { discordWebhookUrl: "https://discord.com/api/webhooks/1/x" } } }, "@everyone down");
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({ title: "#7 @everyone down", url: "https://app.example.com/incidents/inc-1", footer: { text: "Supercheck" } });
  });

  it("escapes Slack control sequences in incident text", async () => {
    const body = await send({ type: "slack", config: { envelope: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } } }, "<!channel> down");
    expect(body.text).not.toContain("<!channel>");
    expect(body.attachments[0].title).toBe("#7 &lt;!channel&gt; down");
  });
});

it("still posts to channels when the assignee email fails", async () => {
  renderIncidentUpdateEmail.mockResolvedValueOnce({ subject: "s", html: "h", text: "t" });
  sendEmailToMultiple.mockResolvedValueOnce({ sentCount: 0, failedAddresses: ["ada@example.com"], errors: {} });
  selectQueue.push([incident], people, [{ sourceType: "monitor", sourceId: "mon-1" }], [
    { id: "p1", type: "slack", projectId: "project-1", config: { envelope: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } } },
  ]);
  await notifyIncidentEvent({ ...base, event: "assigned" });
  expect(sendEmailToMultiple).toHaveBeenCalledTimes(1);
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
});

it("still posts to channels when the name lookup fails", async () => {
  selectQueue.push([incident]);
  const { db } = jest.requireMock("@/utils/db") as { db: { select: jest.Mock } };
  const failing = chain([]);
  failing.catch = (handler: (error: Error) => unknown) => Promise.resolve(handler(new Error("db down")));
  db.select.mockImplementationOnce(() => chain(selectQueue.shift() ?? [])).mockImplementationOnce(() => failing);
  selectQueue.push([{ sourceType: "monitor", sourceId: "mon-1" }], [
    { id: "p1", type: "slack", projectId: "project-1", config: { envelope: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } } },
  ]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchPublicEndpoint.mock.calls[0][1].body).text).toBe("Incident resolved: #7 Checkout down");
});

it("keeps the incident link when Telegram text is clipped", async () => {
  selectQueue.push([{ ...incident, title: "x".repeat(5000) }], people, [{ sourceType: "monitor", sourceId: "mon-1" }], [
    { id: "p1", type: "telegram", projectId: "project-1", config: { envelope: { botToken: "123:abc", chatId: "-100" } } },
  ]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  const { text } = JSON.parse(fetchPublicEndpoint.mock.calls[0][1].body);
  expect(text.length).toBeLessThanOrEqual(4096);
  expect(text.endsWith("https://app.example.com/incidents/inc-1")).toBe(true);
});

it("never throws when delivery fails", async () => {
  fetchPublicEndpoint.mockRejectedValueOnce(new Error("boom"));
  selectQueue.push([incident], people, [{ sourceType: "job", sourceId: "job-1" }], [{ id: "p1", type: "discord", config: { discordWebhookUrl: "https://discord.com/api/webhooks/1/x" } }]);
  await expect(notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null })).resolves.toBeUndefined();
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ error: "boom" }), "Incident notification delivery failed");
});

it("logs a delivery failure when the endpoint answers with a non-2xx status", async () => {
  fetchPublicEndpoint.mockResolvedValueOnce({ ok: false, status: 404 });
  selectQueue.push([incident], people, [{ sourceType: "job", sourceId: "job-1" }], [{ id: "p1", type: "discord", config: { discordWebhookUrl: "https://discord.com/api/webhooks/1/x" } }]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ error: "HTTP 404" }), "Incident notification delivery failed");
});

it("fails open on dedupe when Redis is unavailable", async () => {
  redisSet.mockRejectedValue(new Error("redis down"));
  selectQueue.push([incident], people, []);
  await notifyIncidentEvent({ ...base, event: "created", assigneeUserId: null });
  expect(selectQueue).toHaveLength(0);
});

it("sends Telegram incident messages as plain text", async () => {
  selectQueue.push([incident], people, [{ sourceType: "monitor", sourceId: "mon-1" }], [{ id: "p1", type: "telegram", projectId: "project-1", config: { envelope: { botToken: "123:abc", chatId: "-100" } } }]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  const [url, init] = fetchPublicEndpoint.mock.calls[0];
  expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
  const body = JSON.parse(init.body);
  expect(body.chat_id).toBe("-100");
  expect(body.parse_mode).toBeUndefined();
  expect(body.text).toContain("https://app.example.com/incidents/inc-1");
});

it("skips webhooks that use a preset or body template but still sends plain webhooks", async () => {
  selectQueue.push([incident], people, [{ sourceType: "monitor", sourceId: "mon-1" }], [
    { id: "w1", type: "webhook", projectId: "project-1", config: { envelope: { url: "https://example.com/a", bodyTemplate: "{\"x\":1}" } } },
    { id: "w2", type: "webhook", projectId: "project-1", config: { envelope: { url: "https://example.com/b", preset: "pagerduty" } } },
    { id: "w3", type: "webhook", projectId: "project-1", config: { envelope: { url: "https://example.com/c", preset: "custom" } } },
  ]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  expect(fetchPublicEndpoint.mock.calls[0][0]).toBe("https://example.com/c");
});

it("sends a plain webhook the fixed incident JSON with its custom headers", async () => {
  selectQueue.push([incident], people, [{ sourceType: "monitor", sourceId: "mon-1" }], [
    { id: "w1", type: "webhook", projectId: "project-1", config: { envelope: { url: "https://example.com/hook", headers: { "X-Token": "t" } } } },
  ]);
  await notifyIncidentEvent({ ...base, event: "resolved", assigneeUserId: null });
  const [url, init] = fetchPublicEndpoint.mock.calls[0];
  expect(url).toBe("https://example.com/hook");
  expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  expect(JSON.parse(init.body)).toMatchObject({
    event: "incident.resolved",
    title: expect.any(String),
    url: "https://app.example.com/incidents/inc-1",
  });
});

describe("one message per event for alert-triggered incidents", () => {
  const provider = { id: "p1", type: "slack", projectId: "project-1", config: { envelope: { webhookUrl: "https://hooks.slack.com/services/T/B/x" } } };
  const source = [{ sourceType: "monitor", sourceId: "mon-1" }];
  const run = (input: Record<string, unknown>, delivered: Array<{ status: string }> = [{ status: "sent" }]) => {
    selectQueue.push([incident], people, source);
    if (input.event === "created") selectQueue.push(delivered);
    selectQueue.push([provider]);
    return notifyIncidentEvent({ ...base, assigneeUserId: null, ...input } as never);
  };

  it.each([
    ["recovered", {}],
    ["reopened", {}],
    ["resolved", { automatic: true }],
  ])("skips channel posts for %s %j", async (event, extra) => {
    await run({ event, ...extra });
    expect(fetchPublicEndpoint).not.toHaveBeenCalled();
  });

  it("skips channel posts for created when the alert was delivered", async () => {
    await run({ event: "created" });
    expect(fetchPublicEndpoint).not.toHaveBeenCalled();
  });

  it("posts created to channels when every alert delivery failed", async () => {
    await run({ event: "created" }, [{ status: "failed" }]);
    expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["assigned", {}],
    ["acknowledged", {}],
    ["ai_finding", {}],
    ["resolved", {}],
  ])("still posts channels for %s", async (event, extra) => {
    await run({ event, ...extra });
    expect(fetchPublicEndpoint).toHaveBeenCalledTimes(1);
  });

  it("still emails the assignee when channels are skipped", async () => {
    selectQueue.push([incident], people, source);
    await notifyIncidentEvent({ ...base, event: "recovered", assigneeUserId: "assignee", actorUserId: null });
    expect(sendEmailToMultiple.mock.calls[0][0].text).toContain("recovered");
    expect(fetchPublicEndpoint).not.toHaveBeenCalled();
  });
});
