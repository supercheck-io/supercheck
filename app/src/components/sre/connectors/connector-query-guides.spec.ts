import { getConnectorQueryGuide, getServiceQuery } from "./connector-query-guides";

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

    expect(gitlab.examples[0]?.query).toContain("project:acme/checkout");
    expect(gitlab.docs?.map((doc) => doc.href)).toContain(
      "https://docs.gitlab.com/api/commits/",
    );
    expect(pagerduty.credentialHint).toContain("incidents.read");
  });

  it("provides knowledge and ticketing setup references", () => {
    const jira = getConnectorQueryGuide("jira");
    const confluence = getConnectorQueryGuide("confluence");
    const notion = getConnectorQueryGuide("notion");

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
  });
});

describe("getServiceQuery", () => {
  it("fills the service recipe with the service name", () => {
    expect(getServiceQuery("tempo", "checkout-api")).toBe(
      '{ resource.service.name = "checkout-api" && status = error }',
    );
    expect(getServiceQuery("loki", "checkout")).toBe('{service="checkout"} |= "error"');
  });

  it("never injects an unsafe or overlong name into any recipe", () => {
    for (const type of ["tempo", "loki", "prometheus", "elasticsearch"]) {
      const example = getConnectorQueryGuide(type).examples[0].query;
      for (const name of ['a b', "x\ny", "a".repeat(101), '}|~"', "a;b"]) {
        expect(getServiceQuery(type, name)).toBe(example);
      }
    }
  });

  it("falls back to the guide example without a usable service name", () => {
    const example = getConnectorQueryGuide("tempo").examples[0].query;
    expect(getServiceQuery("tempo", "")).toBe(example);
    expect(getServiceQuery("tempo", 'bad"name')).toBe(example);
    expect(getServiceQuery("github", "checkout")).toBe(
      getConnectorQueryGuide("github").examples[0].query,
    );
  });
});
