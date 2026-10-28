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
} from "./index";

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
  ["incident-update", <IncidentUpdateEmail key="h" event="created" incidentNumber={7} title="Checkout failing" severity="sev1" statusLabel="Open" serviceName="Checkout" detail="<b>x</b>" incidentUrl="https://app.io/incidents/7" />, ["Open incident #7", "SEV1", "Checkout failing", "&lt;b&gt;x&lt;/b&gt;", "https://app.io/incidents/7"]],
  ["test-email", <TestEmail key="i" />, ["Supercheck"]],
];

describe("email templates", () => {
  it.each(cases)("%s renders content inside the shared layout", (_name, el, expected) => {
    const html = renderToStaticMarkup(el);
    for (const s of expected) expect(html).toContain(s);
    expect(html).toContain('class="sc-container"');
    expect(html.toLowerCase()).toContain(FOOTER_MARK);
  });

  it("monitor alert: recovery says Resolved and has no incidents button", () => {
    const html = renderToStaticMarkup(
      <MonitorAlertEmail title="Up" message="ok" fields={[]} footer="x" type="success" incidentsUrl="https://app.io/incidents" />,
    );
    expect(html).toContain("Resolved");
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
