import { describeNotificationEvent } from "./incident-notification-event";

describe("describeNotificationEvent", () => {
  it("names reminders with counts, never addresses", () => {
    expect(describeNotificationEvent({ kind: "reminder", n: 2, of: 3, channels: [{ providerId: "p", type: "slack", ok: true }, { providerId: "q", type: "email", ok: false }], emailed: 1 })).toEqual({
      title: "Reminder 2 of 3 sent",
      body: "Sent to 1 channel and 1 person by email",
      warning: false,
    });
    expect(describeNotificationEvent({ kind: "reminder", channels: [], emailed: 2 }).body).toBe("Sent to 2 people by email");
    expect(describeNotificationEvent({ kind: "reminder", n: 1, of: 1, channels: [], emailed: 0 })).toMatchObject({ body: "Nobody could be reached", warning: true });
  });

  it("names escalations and a removed target", () => {
    expect(describeNotificationEvent({ kind: "escalation", channels: [{ ok: true }, { ok: true }], emailed: 0, reached: 2 })).toEqual({ title: "Escalated", body: "Sent to 2 channels", warning: false });
    expect(describeNotificationEvent({ kind: "escalation", reached: 0, channels: [], emailed: 0 })).toMatchObject({ title: "Escalation not sent", warning: true });
  });

  it("names a failed page with the vendor, status and fallback", () => {
    expect(describeNotificationEvent({ kind: "page_failed", preset: "pagerduty", status: 503, fallback: "policy_channels" })).toEqual({
      title: "PagerDuty page failed (HTTP 503)",
      body: "The incident was sent to the project's incident channels instead.",
      warning: true,
    });
    expect(describeNotificationEvent({ kind: "page_failed", preset: "opsgenie", status: 401, terminal: true, fallback: "admins" }).body).toBe(
      "Check the integration key. Project owners and admins were emailed instead.",
    );
    expect(describeNotificationEvent({ kind: "page_failed", preset: "unknown", fallback: "none" })).toEqual({ title: "Paging service page failed", body: null, warning: true });
    expect(describeNotificationEvent({ kind: "other" })).toEqual({ title: "Notification", body: null, warning: false });
  });
});

it("reports a given-up reminder or escalation as undelivered, not sent or removed", () => {
  expect(describeNotificationEvent({ kind: "reminder", n: 2, of: 3, failed: true, attempts: 5, reached: 0 })).toEqual({
    title: "Reminder 2 could not be delivered",
    body: "Every channel failed on 5 attempts; it was given up. Check the channels on the Notifications page.",
    warning: true,
  });
  expect(describeNotificationEvent({ kind: "escalation", failed: true, reached: 0 }).title).toBe("Escalation could not be delivered");
});
