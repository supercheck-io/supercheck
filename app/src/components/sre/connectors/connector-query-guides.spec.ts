import { getConnectorQueryGuide } from "./connector-query-guides";

describe("connector query guides", () => {
  it("provides CloudWatch alarm and metric examples with production references", () => {
    const guide = getConnectorQueryGuide("aws_cloudwatch");

    expect(guide.endpointPlaceholder).toBe(
      "https://monitoring.us-east-1.amazonaws.com",
    );
    expect(guide.examples.map((example) => example.query)).toEqual(
      expect.arrayContaining([
        "prefix:checkout state:ALARM",
        "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout stat:Average period:60",
      ]),
    );
    expect(guide.docs?.map((doc) => doc.href)).toEqual(
      expect.arrayContaining([
        "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html",
      ]),
    );
  });

  it("falls back to a safe generic guide for unsupported connector types", () => {
    const guide = getConnectorQueryGuide("future_connector");

    expect(guide.queryPlaceholder).toBe(
      "Search for recent operational evidence",
    );
    expect(guide.examples[0]?.query).toBe("error");
  });

  it("documents executable GitLab and incident-management queries", () => {
    const gitlab = getConnectorQueryGuide("gitlab");
    const pagerduty = getConnectorQueryGuide("pagerduty");
    const opsgenie = getConnectorQueryGuide("opsgenie");

    expect(gitlab.examples[0]?.query).toContain("project:acme/checkout");
    expect(gitlab.docs?.map((doc) => doc.href)).toContain(
      "https://docs.gitlab.com/api/commits/",
    );
    expect(pagerduty.credentialHint).toContain("incidents.read");
    expect(opsgenie.docs?.map((doc) => doc.href)).toContain(
      "https://docs.opsgenie.com/docs/alert-api",
    );
  });

  it("provides knowledge, ticketing, and chat setup references", () => {
    const jira = getConnectorQueryGuide("jira");
    const confluence = getConnectorQueryGuide("confluence");
    const notion = getConnectorQueryGuide("notion");
    const slack = getConnectorQueryGuide("slack");

    expect(jira.docs?.map((doc) => doc.href)).toEqual(
      expect.arrayContaining([
        "https://support.atlassian.com/jira-software-cloud/docs/what-is-advanced-search-in-jira-cloud/",
      ]),
    );
    expect(confluence.docs?.map((doc) => doc.href)).toEqual(
      expect.arrayContaining([
        "https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/",
      ]),
    );
    expect(notion.examples[0]?.query).toContain("runbook");
    expect(slack.docs?.map((doc) => doc.href)).toEqual(
      expect.arrayContaining([
        "https://docs.slack.dev/reference/methods/search.messages/",
      ]),
    );
  });
});
