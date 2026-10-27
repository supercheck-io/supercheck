import {
  renderEmailVerificationEmail,
  renderIncidentNotificationEmail,
  renderIncidentUpdateEmail,
  renderMonitorAlertEmail,
  renderOrganizationInvitationEmail,
  renderPasswordResetEmail,
  renderStatusPageVerificationEmail,
  renderStatusPageWelcomeEmail,
  renderTestEmail,
  renderTrialNotificationEmail,
  renderUsageNotificationEmail,
} from "./email-renderer";

// Real @react-email/render needs a dynamic import Jest cannot run, so mock it with
// the static markup renderer; this still verifies subject/html/text wiring.
jest.mock("@react-email/render", () => {
  const { renderToStaticMarkup } = jest.requireActual("react-dom/server");
  return {
    render: async (el: React.ReactElement, opts?: { plainText?: boolean }) =>
      opts?.plainText ? "plain: " + renderToStaticMarkup(el).replace(/<[^>]+>/g, " ") : renderToStaticMarkup(el),
  };
});

describe("renderIncidentUpdateEmail", () => {
  it("returns subject, html and text", async () => {
    const r = await renderIncidentUpdateEmail({
      event: "resolved",
      incidentNumber: 12,
      title: "API errors",
      severity: "sev2",
      statusLabel: "Resolved",
      incidentUrl: "https://app.io/incidents/12",
      actorName: "Dana",
    });
    expect(r.subject).toBe("[SEV2] Incident resolved by Dana: #12 API errors");
    expect(r.html).toContain("Open incident #12");
    expect(r.text).toContain("API errors");
  });
});

describe("render* functions", () => {
  const cases: Array<[string, () => Promise<{ subject: string; html: string; text: string }>, string | RegExp, string]> = [
    ["password reset", () => renderPasswordResetEmail({ resetUrl: "https://app.io/reset?t=1", userEmail: "a@b.co" }), "Reset your Supercheck password", "https://app.io/reset?t=1"],
    ["email verification", () => renderEmailVerificationEmail({ verificationUrl: "https://app.io/verify?t=2", userEmail: "a@b.co" }), "Verify your email address - Supercheck", "https://app.io/verify?t=2"],
    ["organization invitation", () => renderOrganizationInvitationEmail({ inviteUrl: "https://app.io/invite/3", organizationName: "Acme", role: "admin" }), "You're invited to join Acme on Supercheck", "https://app.io/invite/3"],
    ["status page verification", () => renderStatusPageVerificationEmail({ verificationUrl: "https://s.io/verify/4", statusPageName: "Acme Status" }), /Acme Status$/, "https://s.io/verify/4"],
    ["status page welcome", () => renderStatusPageWelcomeEmail({ statusPageName: "Acme Status", statusPageUrl: "https://s.io", unsubscribeUrl: "https://s.io/unsub/5" }), /Acme Status$/, "https://s.io/unsub/5"],
    ["status page incident", () => renderIncidentNotificationEmail({ statusPageName: "Acme Status", statusPageUrl: "https://s.io", incidentName: "DB outage", incidentStatus: "investigating", incidentImpact: "major", incidentDescription: "Looking into it", affectedComponents: ["API"], updateTimestamp: "2026-01-01T00:00:00Z", unsubscribeUrl: "https://s.io/unsub/6" }), /^\[INVESTIGATING\] DB outage - Acme Status$/, "DB outage"],
    ["monitor alert", () => renderMonitorAlertEmail({ title: "Monitor down: API", message: "API is failing", fields: [{ title: "Region", value: "eu" }], footer: "Supercheck", type: "failure", color: "#ff0000" }), "Monitor down: API", "API is failing"],
    ["test email", () => renderTestEmail({ testMessage: "hello world" }), "Test Email from Supercheck", "hello world"],
    ["usage notification", () => renderUsageNotificationEmail({ organizationName: "Acme", notificationType: "usage_80_percent", resourceType: "playwright", usageAmount: 80, usageLimit: 100, usagePercentage: 80, billingPageUrl: "https://app.io/billing", periodEndDate: "2026-02-01" }), "[80% Warning] Acme - Supercheck", "Acme"],
    ["trial notification", () => renderTrialNotificationEmail({ organizationName: "Acme", kind: "midway", daysRemaining: 7, subscribeUrl: "https://app.io/subscribe" }), /- Acme on Supercheck$/, "https://app.io/subscribe"],
  ];

  it.each(cases)("%s returns subject, html and text wired to its props", async (_name, run, subject, marker) => {
    const r = await run();
    expect(r.subject).toEqual(expect.any(String));
    if (typeof subject === "string") expect(r.subject).toBe(subject);
    else expect(r.subject).toMatch(subject);
    expect(r.html.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.html).toContain(marker);
  });

  it("falls back to a generic usage subject for an unknown notification type", async () => {
    const r = await renderUsageNotificationEmail({
      organizationName: "Acme",
      notificationType: "bogus" as never,
      resourceType: "ai",
      usageAmount: 1,
      usageLimit: 2,
      usagePercentage: 50,
      billingPageUrl: "https://app.io/billing",
      periodEndDate: "2026-02-01",
    });
    expect(r.subject).toBe("Usage Alert - Acme");
  });
});
