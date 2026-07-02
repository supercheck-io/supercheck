import { createDirectConnector } from "./direct-connectors";
import { type ConnectorDefinition, type ConnectorSearchParams } from "./connector-base";

const baseDefinition: ConnectorDefinition = {
  id: "connector_1",
  type: "github",
  riskLevel: "low",
  permissionLevel: "read",
  sideEffectLevel: "none",
  surfaces: ["code"],
  evidenceTypes: ["deployment"],
  requires: ["credentials"],
  status: "valid",
  scopedServiceIds: ["service_1"],
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 10, maxBytes: 10_000, maxSeconds: 5 },
};

const params: ConnectorSearchParams = {
  query: "repo:acme/checkout deploy",
  serviceId: "service_1",
  timeWindow: {
    start: new Date("2026-06-21T10:00:00.000Z"),
    end: new Date("2026-06-21T11:00:00.000Z"),
  },
  budget: { maxRows: 5, maxBytes: 10_000, maxSeconds: 5, maxCost: 0 },
};

describe("direct connectors", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizes GitHub commit search results into cited evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            sha: "abcdef1234567890",
            html_url: "https://github.com/acme/checkout/commit/abcdef",
            repository: { full_name: "acme/checkout" },
            commit: {
              message: "Deploy checkout service\n\nRelease notes",
              author: { name: "SRE Bot", date: "2026-06-21T10:30:00.000Z" },
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({ ...baseDefinition, type: "github", credential: { secret: "token" } });
    const evidence = await connector.search(params);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      source: "github",
      title: "Deploy checkout service",
      sourceUri: "https://github.com/acme/checkout/commit/abcdef",
      evidenceType: "deployment",
    });
    expect(evidence[0].citation.resultHash).toHaveLength(64);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.github.com/search/commits"),
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("normalizes Prometheus query_range results into metric evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [{ metric: { __name__: "up", job: "checkout" }, values: [[1782036000, "1"]] }],
        },
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "prometheus",
      endpointUrl: "https://prometheus.example.com",
      surfaces: ["metrics"],
      evidenceTypes: ["metric"],
    });
    const evidence = await connector.search({ ...params, query: "up" });

    expect(evidence[0]).toMatchObject({
      source: "prometheus",
      title: "Prometheus metric: up",
      evidenceType: "metric",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/query_range"),
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("normalizes Grafana dashboard search results into document evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([{ title: "Checkout Overview", url: "/d/abc/checkout", type: "dash-db", tags: ["checkout"] }]),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "grafana",
      endpointUrl: "https://grafana.example.com",
      surfaces: ["metrics"],
      evidenceTypes: ["document"],
      credential: { secret: "token" },
    });
    const evidence = await connector.search({ ...params, query: "checkout" });

    expect(evidence[0]).toMatchObject({
      source: "grafana",
      title: "Checkout Overview",
      sourceUri: "https://grafana.example.com/d/abc/checkout",
      evidenceType: "document",
    });
  });

  it("validates Grafana credentials with an authenticated search endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "grafana",
      endpointUrl: "https://grafana.example.com",
      surfaces: ["metrics"],
      evidenceTypes: ["document"],
      credential: { secret: "fake-token" },
    });

    const result = await connector.validate();

    expect(result.status).toBe("invalid_credentials");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/search?limit=1"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer fake-token" }),
      })
    );
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/health"), expect.anything());
  });

  it("normalizes Kubernetes pods into topology evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            metadata: {
              name: "checkout-api-7d9c",
              namespace: "payments",
              uid: "pod-1",
              labels: { app: "checkout" },
            },
            spec: { nodeName: "node-a", serviceAccountName: "checkout" },
            status: {
              phase: "Running",
              startTime: "2026-06-21T10:10:00.000Z",
              containerStatuses: [{ name: "app", ready: true, restartCount: 1 }],
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "kubernetes",
      endpointUrl: "https://kubernetes.example.com",
      surfaces: ["infra"],
      evidenceTypes: ["topology"],
      credential: { secret: "token" },
    });
    const evidence = await connector.search({ ...params, query: "app=checkout", filters: { namespace: "payments" } });

    expect(evidence[0]).toMatchObject({
      source: "kubernetes",
      title: "Kubernetes pod: payments/checkout-api-7d9c",
      sourceUri: "https://kubernetes.example.com/api/v1/namespaces/payments/pods/checkout-api-7d9c",
      evidenceType: "topology",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/namespaces/payments/pods"),
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("normalizes Sentry issues into event evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: "123",
          shortId: "CHECKOUT-1",
          title: "Checkout timeout",
          culprit: "checkout.views.pay",
          permalink: "https://sentry.example.com/issues/123",
          level: "error",
          status: "unresolved",
          count: "42",
          firstSeen: "2026-06-21T10:00:00.000Z",
          lastSeen: "2026-06-21T10:45:00.000Z",
        },
      ]),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "sentry",
      endpointUrl: "https://sentry.example.com/api/0/projects/acme/checkout",
      surfaces: ["logs"],
      evidenceTypes: ["event"],
      credential: { secret: "token" },
    });
    const evidence = await connector.search({ ...params, query: "is:unresolved timeout" });

    expect(evidence[0]).toMatchObject({
      source: "sentry",
      title: "Sentry issue: Checkout timeout",
      sourceUri: "https://sentry.example.com/issues/123",
      evidenceType: "event",
      metadata: expect.objectContaining({ severity: "error" }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/0/projects/acme/checkout/issues/"),
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("normalizes Datadog events into event evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          {
            id: 42,
            title: "Checkout error spike",
            text: "Increased 5xx responses on checkout-api",
            date_happened: 1782038700,
            alert_type: "error",
            source: "monitor",
            host: "checkout-api-1",
            tags: ["service:checkout"],
            url: "https://app.datadoghq.com/event/event?id=42",
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "datadog",
      endpointUrl: "https://api.datadoghq.com",
      surfaces: ["metrics"],
      evidenceTypes: ["event"],
      credential: { apiKey: "api-key", applicationKey: "app-key" },
    });
    const evidence = await connector.search({ ...params, query: "service:checkout" });

    expect(evidence[0]).toMatchObject({
      source: "datadog",
      title: "Datadog event: Checkout error spike",
      sourceUri: "https://app.datadoghq.com/event/event?id=42",
      evidenceType: "event",
      metadata: expect.objectContaining({ severity: "error" }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/events"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({ "DD-API-KEY": "api-key", "DD-APPLICATION-KEY": "app-key" }),
      })
    );
  });

  it("classifies Datadog validate=false responses as invalid credentials", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valid: false }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "datadog",
      endpointUrl: "https://api.datadoghq.com",
      surfaces: ["metrics"],
      evidenceTypes: ["event"],
      credential: { apiKey: "bad-api-key", applicationKey: "bad-app-key" },
    });

    const result = await connector.validate();

    expect(result.status).toBe("invalid_credentials");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.datadoghq.com/api/v1/validate",
      expect.objectContaining({
        headers: expect.objectContaining({ "DD-API-KEY": "bad-api-key", "DD-APPLICATION-KEY": "bad-app-key" }),
      })
    );
  });

  it("classifies missing Datadog keys as invalid credentials without probing the network", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "datadog",
      endpointUrl: "https://api.datadoghq.com",
      surfaces: ["metrics"],
      evidenceTypes: ["event"],
      credential: { apiKey: "api-key" },
    });

    const result = await connector.validate();

    expect(result.status).toBe("invalid_credentials");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("normalizes Loki query_range results into log evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          result: [
            {
              stream: { service: "checkout", level: "error" },
              values: [["1782038700000000000", "error checkout failed with upstream timeout"]],
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "loki",
      endpointUrl: "https://loki.example.com",
      surfaces: ["logs"],
      evidenceTypes: ["log"],
    });
    const evidence = await connector.search({ ...params, query: '{service="checkout"} |= "error"' });

    expect(evidence[0]).toMatchObject({
      source: "loki",
      title: "Loki log: error checkout failed with upstream timeout",
      evidenceType: "log",
      summary: "service=checkout, level=error",
      metadata: expect.objectContaining({ severity: "error", tags: expect.arrayContaining(["loki", "service:checkout", "level:error"]) }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/loki/api/v1/query_range"),
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("validates Loki through its query API instead of the readiness probe", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", data: [] }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "loki",
      endpointUrl: "https://loki.example.com",
      surfaces: ["logs"],
      evidenceTypes: ["log"],
    });

    const result = await connector.validate();

    expect(result.status).toBe("valid");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://loki.example.com/loki/api/v1/labels",
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/ready"), expect.anything());
  });

  it("normalizes Elasticsearch search hits into log evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hits: {
          hits: [
            {
              _id: "log-1",
              _index: "logs-checkout-2026.06.21",
              _score: 12.25,
              _source: {
                "@timestamp": "2026-06-21T10:45:00.000Z",
                message: "checkout upstream timeout error",
                service: { name: "checkout" },
                log: { level: "error" },
              },
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "elasticsearch",
      endpointUrl: "https://search.example.com",
      surfaces: ["logs"],
      evidenceTypes: ["log"],
      credential: { secret: "token" },
    });
    const evidence = await connector.search({ ...params, query: "service:checkout AND error", filters: { index: "logs-checkout-*" } });

    expect(evidence[0]).toMatchObject({
      source: "elasticsearch",
      title: "Elasticsearch log: checkout upstream timeout error",
      sourceUri: "https://search.example.com/logs-checkout-2026.06.21/_doc/log-1",
      evidenceType: "log",
      summary: "logs-checkout-2026.06.21 · checkout · error · score 12.25",
      metadata: expect.objectContaining({ severity: "error", tags: expect.arrayContaining(["elasticsearch", "logs-checkout-2026.06.21", "checkout"]) }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/logs-checkout-*/_search"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("q=%28service%3Acheckout+AND+error%29+AND+%40timestamp"),
      expect.anything()
    );
  });

  it("normalizes Tempo trace search results into trace evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        traces: [
          {
            traceID: "4bf92f3577b34da6a3ce929d0e0e4736",
            rootServiceName: "checkout",
            rootTraceName: "POST /checkout",
            startTimeUnixNano: "1782038700000000000",
            durationMs: 1240,
            serviceStats: {
              checkout: { spanCount: 8 },
              payments: { spanCount: 3 },
            },
            spanSets: [
              {
                spans: [
                  {
                    attributes: [
                      { key: "http.status_code", value: { intValue: 500 } },
                      { key: "status", value: { stringValue: "error" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "tempo",
      endpointUrl: "https://tempo.example.com",
      surfaces: ["traces"],
      evidenceTypes: ["trace"],
      credential: { secret: "token" },
    });
    const evidence = await connector.search({ ...params, query: "service:checkout minDuration:100ms" });

    expect(evidence[0]).toMatchObject({
      source: "tempo",
      title: "Tempo trace: checkout POST /checkout",
      sourceUri: "https://tempo.example.com/api/traces/4bf92f3577b34da6a3ce929d0e0e4736",
      evidenceType: "trace",
      summary: "4bf92f3577b34da6a3ce929d0e0e4736 · duration 1.24s · services checkout, payments",
      metadata: expect.objectContaining({
        severity: "error",
        tags: expect.arrayContaining(["tempo", "trace", "checkout", "service:checkout", "service:payments", "http.status_code=500", "status=error"]),
      }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/search"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("tags=service.name%3Dcheckout"),
      expect.anything()
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("minDuration=100ms"),
      expect.anything()
    );
  });

  it("normalizes AWS CloudWatch alarms into metric evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <DescribeAlarmsResponse>
          <DescribeAlarmsResult>
            <MetricAlarms>
              <member>
                <AlarmName>checkout-5xx-rate</AlarmName>
                <AlarmArn>arn:aws:cloudwatch:us-east-1:123456789012:alarm:checkout-5xx-rate</AlarmArn>
                <AlarmDescription>Checkout 5xx rate exceeded threshold</AlarmDescription>
                <StateValue>ALARM</StateValue>
                <StateReason>Threshold Crossed: 3 datapoints were greater than the threshold.</StateReason>
                <StateUpdatedTimestamp>2026-06-21T10:55:00.000Z</StateUpdatedTimestamp>
                <Namespace>AWS/ApplicationELB</Namespace>
                <MetricName>HTTPCode_Target_5XX_Count</MetricName>
                <Statistic>Sum</Statistic>
                <Threshold>10.0</Threshold>
                <ComparisonOperator>GreaterThanThreshold</ComparisonOperator>
              </member>
            </MetricAlarms>
          </DescribeAlarmsResult>
        </DescribeAlarmsResponse>
      `,
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "aws_cloudwatch",
      endpointUrl: "https://monitoring.us-east-1.amazonaws.com",
      surfaces: ["metrics"],
      evidenceTypes: ["metric"],
      credential: { apiKey: "access-key", secret: "secret-key", sessionToken: "session-token" },
    });
    const evidence = await connector.search({ ...params, query: "checkout-" });

    expect(evidence[0]).toMatchObject({
      source: "aws_cloudwatch",
      title: "CloudWatch alarm: checkout-5xx-rate",
      evidenceType: "metric",
      metadata: expect.objectContaining({ severity: "critical", tags: expect.arrayContaining(["aws", "cloudwatch", "alarm", "ALARM"]) }),
    });
    expect(evidence[0].summary).toContain("AWS/ApplicationELB/HTTPCode_Target_5XX_Count");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://monitoring.us-east-1.amazonaws.com",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("AWS4-HMAC-SHA256 Credential=access-key/"),
          "X-Amz-Security-Token": "session-token",
        }),
        body: expect.stringContaining("Action=DescribeAlarms"),
      })
    );
  });

  it("normalizes AWS CloudWatch GetMetricData results into metric evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <GetMetricDataResponse>
          <GetMetricDataResult>
            <MetricDataResults>
              <member>
                <Id>m1</Id>
                <Label>CPUUtilization</Label>
                <StatusCode>Complete</StatusCode>
                <Timestamps>
                  <member>2026-06-21T10:59:00.000Z</member>
                </Timestamps>
                <Values>
                  <member>42.5</member>
                </Values>
              </member>
            </MetricDataResults>
          </GetMetricDataResult>
        </GetMetricDataResponse>
      `,
    }) as unknown as typeof fetch;

    const connector = createDirectConnector({
      ...baseDefinition,
      type: "aws_cloudwatch",
      endpointUrl: "https://monitoring.us-east-1.amazonaws.com",
      surfaces: ["metrics"],
      evidenceTypes: ["metric"],
      credential: { apiKey: "access-key", secret: "secret-key" },
    });
    const evidence = await connector.search({
      ...params,
      query: "namespace:AWS/EC2 metric:CPUUtilization dimension:InstanceId=i-123 stat:Average period:300",
    });

    expect(evidence[0]).toMatchObject({
      source: "aws_cloudwatch",
      title: "CloudWatch metric: CPUUtilization",
      evidenceType: "metric",
      summary: "1 datapoint · latest 42.5 · InstanceId=i-123",
      metadata: expect.objectContaining({ tags: expect.arrayContaining(["aws", "cloudwatch", "metric", "AWS/EC2", "CPUUtilization", "InstanceId:i-123"]) }),
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://monitoring.us-east-1.amazonaws.com",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Action=GetMetricData"),
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("MetricDataQueries.member.1.MetricStat.Metric.Dimensions.member.1.Name=InstanceId"),
      })
    );
  });
});
