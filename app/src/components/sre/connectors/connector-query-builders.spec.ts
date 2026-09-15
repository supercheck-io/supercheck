import { getConnectorQueryBuilder } from "./connector-query-builders";

describe("connector query builders", () => {
  it("builds CloudWatch metric queries with dimensions", () => {
    const builder = getConnectorQueryBuilder("aws_cloudwatch");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      alarmPrefix: "checkout",
      alarmState: "ALARM",
      namespace: "AWS/ApplicationELB",
      metricName: "TargetResponseTime",
      dimensions: "LoadBalancer=app/checkout,TargetGroup=targetgroup/api",
      statistic: "Average",
      periodSeconds: "60",
    });

    expect(result).toEqual({
      query: "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout dimension:TargetGroup=targetgroup/api stat:Average period:60",
    });
  });

  it("builds label-first LogQL queries", () => {
    const builder = getConnectorQueryBuilder("loki");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      labels: "service:checkout,env:prod",
      contains: "",
      regex: "timeout|deadline",
    });

    expect(result.query).toBe('{service="checkout",env="prod"} |~ "timeout|deadline"');
  });

  it("builds Elasticsearch queries with safe filters", () => {
    const builder = getConnectorQueryBuilder("elasticsearch");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      queryString: "service.name:checkout AND error",
      index: "logs-prod-*",
      timestampField: "event.ingested",
    });

    expect(result).toEqual({
      query: "service.name:checkout AND error",
      filters: {
        index: "logs-prod-*",
        timestampField: "event.ingested",
      },
    });
  });

  it("prefers TraceQL when provided for Tempo", () => {
    const builder = getConnectorQueryBuilder("tempo");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      traceQl: '{ resource.service.name = "checkout" && status = error }',
      service: "checkout",
      operation: "POST /checkout",
      minDuration: "1s",
      maxDuration: "10s",
    });

    expect(result.query).toBe('{ resource.service.name = "checkout" && status = error }');
  });

  it("builds Jira JQL for service ticket context", () => {
    const builder = getConnectorQueryBuilder("jira");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      projectKey: "CHECKOUT",
      serviceLabel: "checkout",
      statuses: "Incident, In Progress",
      text: "checkout latency",
      updatedWithin: "-14d",
    });

    expect(result.query).toBe('project = CHECKOUT AND labels = "checkout" AND status in ("Incident", "In Progress") AND text ~ "checkout latency" AND updated >= -14d');
  });

  it("builds Confluence CQL for operational docs", () => {
    const builder = getConnectorQueryBuilder("confluence");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      spaceKey: "SRE",
      contentType: "page",
      serviceTerm: "checkout",
      text: "runbook",
      updatedWithin: "-90d",
    });

    expect(result.query).toBe('space = "SRE" AND type = "page" AND text ~ "checkout" AND text ~ "runbook" AND lastmodified >= now("-90d")');
  });

  it("builds Notion search text with safe hints", () => {
    const builder = getConnectorQueryBuilder("notion");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      query: "checkout incident runbook",
      objectType: "page",
      dataSource: "sre-runbooks",
    });

    expect(result.query).toBe("checkout incident runbook type:page source:sre-runbooks");
  });

  it("builds Slack message search syntax", () => {
    const builder = getConnectorQueryBuilder("slack");
    expect(builder).not.toBeNull();

    const result = builder!.build({
      channel: "incidents",
      serviceTerm: "checkout",
      text: "timeout",
      afterDate: "2026-06-01",
    });

    expect(result.query).toBe("in:#incidents checkout timeout after:2026-06-01");
  });
});
