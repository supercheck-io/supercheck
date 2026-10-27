import { renderIncidentUpdateEmail } from "./email-renderer";

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
