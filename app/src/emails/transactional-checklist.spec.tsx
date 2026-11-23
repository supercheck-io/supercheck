/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmailVerificationEmail,
  ExistingAccountEmail,
  IncidentNotificationEmail,
  IncidentUpdateEmail,
  MonitorAlertEmail,
  OrganizationDeletionEmail,
  OrganizationInvitationEmail,
  PasswordResetEmail,
  StatusPageVerificationEmail,
  StatusPageWelcomeEmail,
  TestEmail,
  TrialNotificationEmail,
  UsageNotificationEmail,
  incidentUpdateSubject,
  usageNotificationTitle,
} from "./index";
import { emailAppUrl } from "./base-layout";
import { getTranslations, SUPPORTED_LANGUAGES } from "../lib/status-page-translations";

// Every template, rendered the way its sender calls it, checked against the transactional-email rules.
const at = new Date("2026-11-23T10:15:00Z");
const templates: Array<[string, React.ReactElement]> = [
  ["password-reset", <PasswordResetEmail key="1" resetUrl="https://app.io/reset-password?token=t" userEmail="u@x.io" />],
  ["existing-account", <ExistingAccountEmail key="2" signInUrl="https://app.io/sign-in" resetUrl="https://app.io/forgot-password" userEmail="u@x.io" />],
  ["email-verification", <EmailVerificationEmail key="3" verificationUrl="https://app.io/api/auth/verify-email?token=t" userEmail="u@x.io" userName="Ada" />],
  ["organization-invitation", <OrganizationInvitationEmail key="4" inviteUrl="https://app.io/invite/i" organizationName="Acme" role="project_editor" projectInfo="Editor in Checkout." />],
  ["status-page-verification", <StatusPageVerificationEmail key="5" verificationUrl="https://app.io/status/verify/t" statusPageName="Acme Status" />],
  ["status-page-welcome", <StatusPageWelcomeEmail key="6" statusPageName="Acme Status" statusPageUrl="https://status.acme.io" unsubscribeUrl="https://app.io/status/unsubscribe/t" />],
  [
    "incident-notification",
    <IncidentNotificationEmail key="7" statusPageName="Acme Status" statusPageUrl="https://status.acme.io" incidentUrl="https://status.acme.io/incidents/i1" incidentName="API errors" incidentStatus="investigating" incidentImpact="major" incidentDescription="Looking into it." affectedComponents={["API"]} updateTimestamp="November 23, 2026 at 10:15:00 AM UTC" unsubscribeUrl="https://app.io/status/unsubscribe/t" />,
  ],
  ["test-email", <TestEmail key="8" sentAt={at} />],
  ["usage-notification", <UsageNotificationEmail key="9" organizationName="Acme" notificationType="usage_80_percent" resourceType="k6" usageAmount={800} usageLimit={1000} usagePercentage={80} billingPageUrl="https://app.io/org-admin?tab=subscription" periodEndDate="Tue, 01 Dec 2026 00:00:00 UTC" />],
  ["trial-notification", <TrialNotificationEmail key="10" organizationName="Acme" kind="ending" daysRemaining={1} subscribeUrl="https://app.io/billing" />],
  ["organization-deletion", <OrganizationDeletionEmail key="11" organizationName="Acme" kind="requested" purgeDate={at} settingsUrl="https://app.io/org-admin" />],
  ["incident-update", <IncidentUpdateEmail key="12" event="created" incidentNumber={15} title="Checkout failing" severity="sev2" statusLabel="Open" incidentUrl="https://app.io/incidents/i" occurredAt={at} />],
  [
    "monitor-alert",
    <MonitorAlertEmail key="13" title="Monitor Down - API" message="API is down" type="failure" footer="" fields={[{ title: "Time", value: "Mon, 23 Nov 2026 10:15:00 UTC" }]} resourceUrl="https://app.io/notification-monitor/m" resourceLabel="Open monitor" incidentsUrl="https://app.io/incidents" manageUrl="https://app.io/notifications" />,
  ],
];

const preheader = (html: string) => /data-skip-in-text="true">([^<]*)</.exec(html)?.[1] ?? "";
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
/** EmailButton is the only dark #111827 link; there must be exactly one per email. */
const primaryButtons = (html: string) => [...html.matchAll(/<a[^>]*background-color:#111827[^>]*>/g)].map((m) => m[0]);
/** Emoji, not the © in the footer. */
const EMOJI = /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}/u;
/** Text a reader sees: no head/styles, no tags, entities decoded. */
const visibleText = (html: string) =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe.each(templates)("%s follows the transactional email checklist", (_name, element) => {
  const html = renderToStaticMarkup(element);
  const visible = visibleText(html);

  it("has a preheader, a language and no placeholder values", () => {
    expect(preheader(html).trim().length).toBeGreaterThan(10);
    expect(html).toMatch(/<html[^>]* lang="[a-z]{2}"/);
    expect(visible).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b|\$ /);
  });

  it("has one primary button at most (exactly one when it asks for an action) and only absolute web links", () => {
    expect(primaryButtons(html)).toHaveLength(_name === "test-email" ? 0 : 1);
    for (const href of hrefs(html)) expect(href).toMatch(/^https?:\/\//);
  });

  it("uses no emoji and no exclamation marks", () => {
    expect(visible).not.toMatch(EMOJI);
    expect(visible).not.toContain("!");
  });

  it("opens with the same Supercheck header lockup as every other email", () => {
    const header = html.slice(html.indexOf("<body"), html.indexOf("<h1"));
    // Wordmark sits in its own middle-aligned cell of the lockup row, not as a stacked label.
    expect(header).toMatch(/<td[^>]*vertical-align:middle[^>]*>\s*<p[^>]*>Supercheck<\/p>\s*<\/td>/);
  });

  it("says why it was sent", () => {
    expect(visible).toMatch(/You received this|You are receiving this|This email was sent because|You're now subscribed/);
  });
});

describe("timestamps carry a time zone", () => {
  it.each(templates.filter(([name]) => ["test-email", "usage-notification", "organization-deletion", "incident-update", "monitor-alert", "incident-notification"].includes(name)))(
    "%s",
    (_name, element) => expect(renderToStaticMarkup(element)).toContain("UTC"),
  );
});

describe("subjects", () => {
  it("incident update subject leads with severity and number and stays short (F9)", () => {
    const subject = incidentUpdateSubject({ event: "created", incidentNumber: 15, severity: "sev2", title: "Checkout API returns 503 for a subset of requests in eu-west during peak traffic" });
    expect(subject.startsWith("[SEV2] #15 Checkout API")).toBe(true);
    expect(subject.endsWith(": New incident opened")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(70);
    expect(subject).toContain("…");
    expect(incidentUpdateSubject({ event: "resolved", incidentNumber: 3, severity: "sev1", title: "DB down", actorName: "Ada" })).toBe("[SEV1] #3 DB down: Incident resolved by Ada");
  });

  it("usage subjects are sentence case and say the state", () => {
    expect(usageNotificationTitle("usage_80_percent")).toBe("Usage at 80% of your plan");
    expect(usageNotificationTitle("spending_limit_reached")).toBe("Spending limit reached");
  });
});

describe("app URL for email links (F2, F3, F12)", () => {
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
  it("prefers NEXT_PUBLIC_APP_URL, then APP_URL, then BETTER_AUTH_URL, and drops trailing slashes", () => {
    expect(emailAppUrl(env({ NEXT_PUBLIC_APP_URL: "https://a.io/", APP_URL: "https://b.io", BETTER_AUTH_URL: "https://c.io" }))).toBe("https://a.io");
    expect(emailAppUrl(env({ APP_URL: "https://b.io//" }))).toBe("https://b.io");
    expect(emailAppUrl(env({ BETTER_AUTH_URL: "https://c.io" }))).toBe("https://c.io");
  });
  it("never returns an empty or undefined base, so links are never relative or 'undefined/...'", () => {
    expect(emailAppUrl(env({}))).toBe("http://localhost:3000");
    expect(`${emailAppUrl(env({}))}/invite/x`).toMatch(/^https?:\/\/[^/]+\/invite\/x$/);
  });
});

describe("status-page subscriber email (F1, F8, F18)", () => {
  const base = {
    statusPageName: "Acme Status",
    statusPageUrl: "https://status.acme.io",
    incidentUrl: "https://status.acme.io/incidents/i1",
    incidentName: "Database upgrade",
    incidentImpact: "none",
    incidentDescription: "Upgrading the primary database.",
    affectedComponents: [],
    updateTimestamp: "now",
    unsubscribeUrl: "https://app.io/status/unsubscribe/t",
  };

  it("a scheduled notice states the window and does not say an incident was reported", () => {
    const html = renderToStaticMarkup(<IncidentNotificationEmail {...base} incidentStatus="scheduled" scheduledWindow="Nov 24, 2026, 02:00 UTC – Nov 24, 2026, 04:00 UTC" />);
    const t = getTranslations("en");
    expect(html).toContain("Nov 24, 2026, 02:00 UTC – Nov 24, 2026, 04:00 UTC");
    expect(html).toContain(t.emailIncidentScheduledIntro);
    expect(html).not.toContain(t.emailIncidentReportedIntro);
    expect(preheader(html)).toContain("Nov 24, 2026, 02:00 UTC");
  });

  it("the main button opens the incident; the preheader names the incident and its status", () => {
    const html = renderToStaticMarkup(<IncidentNotificationEmail {...base} incidentName="API errors" incidentStatus="investigating" incidentImpact="major" />);
    expect(primaryButtons(html)[0]).toContain('href="https://status.acme.io/incidents/i1"');
    expect(html).toContain("View incident");
    expect(preheader(html)).toBe("API errors: Investigating");
  });

  it("every language has the scheduled intro and incident button text", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      const t = getTranslations(code);
      expect(t.emailIncidentScheduledIntro.length).toBeGreaterThan(10);
      expect(t.emailViewIncident.length).toBeGreaterThan(2);
    }
  });
});

describe("alert email (F5)", () => {
  it("the monitor is the main button; incidents is a text link", () => {
    const html = renderToStaticMarkup(templates.find(([name]) => name === "monitor-alert")![1]);
    expect(primaryButtons(html)[0]).toContain('href="https://app.io/notification-monitor/m"');
    expect(html).toContain("Open monitor");
    expect(html).toMatch(/<a[^>]*href="https:\/\/app.io\/incidents"[^>]*>View incidents<\/a>/);
    expect(html).not.toContain("Run ID");
  });
});

describe("account emails (F13, F15, F16)", () => {
  it("verification states the 1-hour expiry and why it was sent", () => {
    const html = renderToStaticMarkup(<EmailVerificationEmail verificationUrl="https://app.io/v" userEmail="u@x.io" />);
    expect(html).toContain("This link expires in 1 hour");
    expect(html).toContain("used to sign up for Supercheck");
    expect(html).toContain("Hi,");
  });

  it("headers are sentence case", () => {
    const titles = Object.fromEntries(
      templates.map(([name, element]) => [name, /<h1[^>]*>([^<]*)<\/h1>/.exec(renderToStaticMarkup(element))?.[1]]),
    );
    expect(titles).toMatchObject({
      "password-reset": "Reset your password",
      "email-verification": "Verify your email address",
      "existing-account": "You already have an account",
      "organization-invitation": "Join Acme on Supercheck",
      "test-email": "Test email",
      "usage-notification": "Usage at 80% of your plan",
    });
  });
});

describe("usage email (F14, F20)", () => {
  const usage = { organizationName: "Acme", resourceType: "spending" as const, usageAmount: 0, usageLimit: 0, usagePercentage: 100, billingPageUrl: "https://app.io/b" };

  it("never prints '$ of your $' or '0 / 0' when amounts are missing", () => {
    const html = renderToStaticMarkup(<UsageNotificationEmail {...usage} notificationType="spending_limit_reached" />);
    const visible = visibleText(html);
    expect(visible).not.toMatch(/\$\s*(of|monthly|\.)/);
    expect(visible).not.toMatch(/0\s*\/\s*0/);
  });

  it("writes k6 in lower case and omits an unknown period end", () => {
    const html = renderToStaticMarkup(<UsageNotificationEmail {...usage} resourceType="k6" usageAmount={5} usageLimit={10} usagePercentage={50} notificationType="usage_50_percent" />);
    expect(html).toContain("k6 virtual user minutes");
    expect(html).not.toContain("K6");
    expect(html).not.toContain("End of billing period");
    expect(html).not.toContain("billing period ends");
  });
});

describe("footer (F19)", () => {
  const prev = process.env.SELF_HOSTED;
  afterEach(() => {
    if (prev === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = prev;
  });

  it("cloud emails link the Supercheck privacy policy and terms", () => {
    delete process.env.SELF_HOSTED;
    const html = renderToStaticMarkup(<TestEmail sentAt={at} />);
    expect(html).toContain("https://supercheck.io/privacy");
    expect(html).toContain("https://supercheck.io/terms");
  });

  it.each(["true", "1", " TRUE "])("self-hosted (SELF_HOSTED=%p) emails carry no supercheck.io legal links", (value) => {
    process.env.SELF_HOSTED = value;
    const html = renderToStaticMarkup(<TestEmail sentAt={at} />);
    expect(html).not.toContain("supercheck.io/privacy");
    expect(html).not.toContain("supercheck.io/terms");
    expect(html).toContain("You received this");
  });
});

describe("header logo", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it("puts the landing-page logo beside the wordmark, on subscriber emails too", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.io";
    const html = renderToStaticMarkup(<StatusPageVerificationEmail verificationUrl="https://app.io/status/verify/t" statusPageName="Acme Status" />);
    const header = html.slice(html.indexOf("<body"), html.indexOf("<h1"));
    expect(header).toMatch(/<tr[^>]*>\s*<td[^>]*padding-right:10px[^>]*>\s*<img[^>]*src="https:\/\/app\.io\/supercheck-logo\.png"[^>]*>\s*<\/td>\s*<td[^>]*>\s*<p[^>]*>Supercheck<\/p>/);
  });
});
