import { assertReadOnlyKql, parseAzureQuery } from "./azure-monitor";
import { parseGcpQuery } from "./gcp-monitoring";
import { parseJaegerQuery } from "./jaeger";
import { assertReadOnlyNrql, nrqlStatisticsError } from "./newrelic";
import { assertReadOnlySpl, splStatisticsError } from "./splunk";

/** Fails fast on queries a provider connector would reject, before any network call. */
export function assertProviderQueryAllowed(connectorType: string, query: string) {
  switch (connectorType) {
    case "newrelic":
      assertReadOnlyNrql(query);
      break;
    case "splunk":
      assertReadOnlySpl(query);
      break;
    case "jaeger":
      parseJaegerQuery(query);
      break;
    case "gcp_monitoring":
      parseGcpQuery(query);
      break;
    case "azure_monitor":
      parseAzureQuery(query);
      break;
    default:
      break;
  }
}

export function providerStatisticsQueryError(connectorType: string, query: string) {
  if (connectorType === "newrelic") return nrqlStatisticsError(query);
  if (connectorType === "splunk") return splStatisticsError(query);
  return null;
}

export { assertReadOnlyKql };
