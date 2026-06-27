import { getConnectorQueryGuide } from "./connector-query-guides";

describe("connector query guides", () => {
  it("provides CloudWatch alarm and metric examples with production references", () => {
    const guide = getConnectorQueryGuide("aws_cloudwatch");

    expect(guide.endpointPlaceholder).toBe("https://monitoring.us-east-1.amazonaws.com");
    expect(guide.examples.map((example) => example.query)).toEqual(
      expect.arrayContaining([
        "prefix:checkout state:ALARM",
        "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout stat:Average period:60",
      ])
    );
    expect(guide.docs?.map((doc) => doc.href)).toEqual(
      expect.arrayContaining(["https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html"])
    );
  });

  it("falls back to a safe generic guide for unsupported connector types", () => {
    const guide = getConnectorQueryGuide("future_connector");

    expect(guide.queryPlaceholder).toBe("Search for recent operational evidence");
    expect(guide.examples[0]?.query).toBe("error");
  });
});
