/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import {
  BaseLayout,
  PasswordResetEmail,
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  StatusPageVerificationEmail,
  StatusPageWelcomeEmail,
  IncidentNotificationEmail,
  MonitorAlertEmail,
  IncidentUpdateEmail,
  TestEmail,
  TrialNotificationEmail,
  UsageNotificationEmail,
  alertEmailSubject,
} from "./index";
import { formatEmailTime } from "./base-layout";

// @react-email/render needs a dynamic import Jest cannot run here; static markup is
// enough to check content. Every email must share the BaseLayout chrome.
const FOOTER_MARK = "supercheck.io"; // standard footer or status-page "powered by" link
const cases: Array<[string, React.ReactElement, string[]]> = [
  ["password-reset", <PasswordResetEmail key="a" resetUrl="https://x.io/r?t=1" userEmail="u@x.io" />, ["Reset Password", "https://x.io/r?t=1"]],
  ["email-verification", <EmailVerificationEmail key="b" verificationUrl="https://x.io/v" userEmail="u@x.io" />, ["https://x.io/v"]],
  ["org-invitation", <OrganizationInvitationEmail key="c" inviteUrl="https://x.io/i" organizationName="Acme" role="admin" />, ["Acme", "https://x.io/i"]],
  ["status-page-verification", <StatusPageVerificationEmail key="d" verificationUrl="https://x.io/sv" statusPageName="Acme Status" />, ["https://x.io/sv", "Acme Status"]],
  ["status-page-welcome", <StatusPageWelcomeEmail key="e" statusPageName="Acme Status" statusPageUrl="https://s.io" unsubscribeUrl="https://s.io/unsub" />, ["https://s.io/unsub", "Acme Status"]],
  ["incident-notification", <IncidentNotificationEmail key="f" statusPageName="Acme Status" statusPageUrl="https://s.io" incidentName="DB down" incidentStatus="investigating" incidentImpact="major" incidentDescription="Looking" affectedComponents={["API"]} updateTimestamp="now" unsubscribeUrl="https://s.io/unsub" />, ["DB down", "https://s.io/unsub", "API"]],
  ["monitor-alert", <MonitorAlertEmail key="g" title="Down" message="API down" fields={[{ title: "Monitor", value: "API" }]} footer="Supercheck Monitoring System" type="failure" incidentsUrl="https://app.io/incidents" />, ["API down", "View incidents", "https://app.io/incidents"]],
  ["incident-update", <IncidentUpdateEmail key="h" event="created" incidentNumber={7} title="Checkout failing" severity="sev1" statusLabel="Open" serviceName="Checkout" detail="<b>x</b>" incidentUrl="https://app.io/incidents/7" assigneeName="Ada" actorName="Grace" />, ["Open incident #7", "SEV1", "Checkout failing", "&lt;b&gt;x&lt;/b&gt;", "https://app.io/incidents/7", "Incident details", "Ada", "Grace", "Supercheck"]],
  ["test-email", <TestEmail key="i" />, ["Supercheck"]],
];

describe("email templates", () => {
  it.each(cases)("%s renders content inside the shared layout", (_name, el, expected) => {
    const html = renderToStaticMarkup(el);
    for (const s of expected) expect(html).toContain(s);
    expect(html).toContain('class="sc-container"');
    expect(html.toLowerCase()).toContain(FOOTER_MARK);
  });

  it("monitor alert: recovery says Recovered/Resolved and has no incidents button", () => {
    const html = renderToStaticMarkup(
      <MonitorAlertEmail title="Up" message="ok" fields={[]} footer="x" type="recovery" incidentsUrl="https://app.io/incidents" />,
    );
    expect(html).toContain("Recovered");
    expect(html).toContain("Resolved");
    expect(html).not.toContain("View incidents");
  });

  it("monitor alert: a plain pass says Passed, not Recovered or Resolved", () => {
    const html = renderToStaticMarkup(
      <MonitorAlertEmail title="Job Completed - x" message="ok" fields={[]} footer="x" type="success" incidentsUrl="https://app.io/incidents" />,
    );
    expect(html).toContain("Passed");
    expect(html).not.toContain("Recovered");
    expect(html).not.toContain("Resolved");
    expect(html).not.toContain("View incidents");
  });

  it("monitor alert: links only http(s) field values", () => {
    const html = renderToStaticMarkup(
      <MonitorAlertEmail
        title="Down"
        message="m"
        footer="x"
        type="failure"
        fields={[
          { title: "URL", value: "https://example.com/health" },
          { title: "Link", value: "javascript:alert(1)" },
        ]}
      />,
    );
    expect(html).toContain('href="https://example.com/health"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
  });

  it("BaseLayout picks readable header text for light colors", () => {
    const html = renderToStaticMarkup(
      <BaseLayout preview="p" title="T" headerColor="#fde68a">x</BaseLayout>,
    );
    expect(html).toContain("color:#111827");
  });
});

describe("email consistency", () => {
  const render = (el: React.ReactElement) => renderToStaticMarkup(el);

  it("alertEmailSubject follows [Supercheck] <Event>: <name>", () => {
    expect(alertEmailSubject("Job Failed - Nightly")).toBe("[Supercheck] Job Failed: Nightly");
    expect(alertEmailSubject("Test alert")).toBe("[Supercheck] Test alert");
  });

  it("monitor alert: info uses blue, not the warning amber", () => {
    const html = render(<MonitorAlertEmail title="t" message="m" fields={[]} footer="x" type="info" />);
    expect(html).toContain("#1d4ed8");
    expect(html).not.toContain("#b45309");
  });

  it("details values keep line breaks (pre-wrap)", () => {
    const html = render(<MonitorAlertEmail title="t" message="m" footer="x" type="failure" fields={[{ title: "Error", value: "a\nb" }]} />);
    expect(html).toContain("white-space:pre-wrap");
  });

  it("auth emails use the neutral header and do not repeat it as a heading", () => {
    const reset = render(<PasswordResetEmail resetUrl="https://x.io/r" userEmail="u@x.io" />);
    expect(reset).toContain("#1f2937");
    expect(reset).not.toContain("Reset Your Password");
    const verify = render(<EmailVerificationEmail verificationUrl="https://x.io/v" userEmail="u@x.io" />);
    expect(verify).not.toContain("#15803d");
    expect(verify).not.toContain("Verify Your Email<");
  });

  it("invitation shows a human role label and renders project info as escaped text", () => {
    const html = render(
      <OrganizationInvitationEmail inviteUrl="https://x.io/i" organizationName="Acme" role="PROJECT_EDITOR" projectInfo={"Access to <img src=x onerror=1>"} />,
    );
    expect(html).toContain("Project Editor");
    expect(html).not.toContain("PROJECT_EDITOR");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("BaseLayout sets lang and dir from the language (RTL for Arabic)", () => {
    expect(render(<BaseLayout preview="p" title="T" lang="ar">x</BaseLayout>)).toContain('dir="rtl" lang="ar"');
    expect(render(<BaseLayout preview="p" title="T">x</BaseLayout>)).toContain('dir="ltr" lang="en"');
  });

  it("status-page welcome does not append the page name after a full sentence", () => {
    const html = render(<StatusPageWelcomeEmail statusPageName="ZZPage" statusPageUrl="https://s.io" unsubscribeUrl="https://s.io/u" />);
    expect(html).not.toContain("ZZPage</strong>.");
  });

  it("trial email shows a Manage billing link only when a billing URL is given", () => {
    const t = { organizationName: "A", kind: "midway" as const, daysRemaining: 7, subscribeUrl: "https://app.io/subscribe" };
    expect(render(<TrialNotificationEmail {...t} />)).not.toContain("Manage billing");
    const html = render(<TrialNotificationEmail {...t} manageBillingUrl="https://app.io/b" />);
    expect(html).toContain("Manage billing");
    expect(html).toContain('href="https://app.io/b"');
  });
});

describe("email shell rules", () => {
  const render = renderToStaticMarkup;
  const org = "Acme's \"Org\" & Co";

  it("escapes names exactly once (no double-escaped apostrophes)", () => {
    const html = render(
      <OrganizationInvitationEmail inviteUrl="https://x.io/i" organizationName={org} role="admin" />,
    );
    expect(html).toContain("Acme&#x27;s &quot;Org&quot; &amp; Co");
    expect(html).not.toMatch(/&amp;(#|quot;|amp;)/);
  });

  it("renders the logo from an absolute public URL with decorative alt text", () => {
    const html = render(<TestEmail />);
    expect(html).toContain('src="https://supercheck.io/supercheck-logo.png"');
    expect(html).toContain('alt=""');
    expect(html).toContain("<title>");
  });

  it("detail labels are row headers", () => {
    const html = render(<MonitorAlertEmail title="t" message="m" fields={[{ title: "Monitor", value: "API" }]} footer="" type="failure" />);
    expect(html).toContain('<th scope="row"');
  });

  it("explains why the alert was sent and links to notification settings", () => {
    const html = render(
      <MonitorAlertEmail title="t" message="m" fields={[]} footer="" type="failure" manageUrl="https://app.io/notifications" />,
    );
    expect(html).toContain("You received this alert");
    expect(html).toContain('href="https://app.io/notifications"');
  });

  it("formats times in UTC with an explicit zone", () => {
    expect(formatEmailTime(new Date("2026-11-18T06:02:36Z"))).toBe("Wed, 18 Nov 2026 06:02:36 UTC");
  });

  it("every action email uses the shared primary button", () => {
    const html = render(<UsageNotificationEmail organizationName="A" notificationType="usage_80_percent" resourceType="playwright" usageAmount={8} usageLimit={10} usagePercentage={80} billingPageUrl="https://x.io/b" periodEndDate="Dec 1" />) +
      render(<TrialNotificationEmail organizationName="A" kind="midway" daysRemaining={7} subscribeUrl="https://x.io/s" />);
    expect(html.match(/background-color:#111827/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("incident email links to notification settings on the incident's origin", () => {
    const ok = render(<IncidentUpdateEmail event="created" incidentNumber={1} title="t" severity="sev2" statusLabel="Open" incidentUrl="https://app.io/incidents/7" />);
    expect(ok).toContain('href="https://app.io/notifications"');
    expect(render(<IncidentUpdateEmail event="created" incidentNumber={1} title="t" severity="sev2" statusLabel="Open" incidentUrl="not a url" />)).not.toContain("Manage notifications");
  });
});
