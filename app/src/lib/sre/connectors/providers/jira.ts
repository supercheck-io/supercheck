import type {
  ConnectorEvidenceItem,
  ConnectorMetadata,
  ConnectorSearchParams,
} from "../connector-base";
import { atlassianAuth } from "./atlassian-auth";
import {
  KnowledgeConnector,
  adfToPlainText,
  buildKnowledgeEvidence,
  dateOrFallback,
  escapeQuotedQueryText,
  knowledgeRequest,
  looksLikeStructuredQuery,
  type KnowledgeConnectorOptions,
} from "./knowledge-shared";

const FIELDS =
  "summary,status,priority,issuetype,labels,created,updated,description";

type JiraIssue = {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
    issuetype?: { name?: string };
    labels?: unknown;
    created?: string;
    updated?: string;
    description?: unknown;
  };
};

export class JiraConnector extends KnowledgeConnector {
  constructor(
    options: Omit<
      KnowledgeConnectorOptions,
      "type" | "surfaces" | "evidenceTypes" | "requires"
    >,
  ) {
    super({
      ...options,
      type: "jira",
      surfaces: ["tickets"],
      evidenceTypes: ["document"],
      requires: ["credentials", "service_scope", "time_window"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Jira",
      description: "Read-only search for related and past incident tickets.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  private auth() {
    const endpoint = this.requireEndpoint("Jira");
    return {
      endpoint,
      ...atlassianAuth("Jira", endpoint, this.token(), this.email()),
    };
  }

  protected validationRequest() {
    const { endpoint, headers, mode } = this.auth();
    const version = mode === "cloud" ? 3 : 2;
    return knowledgeRequest({
      provider: "Jira",
      url: `${endpoint}/rest/api/${version}/myself`,
      headers,
      timeoutMs: this.timeoutMs(),
    });
  }

  /** Plain text is searched as text; anything that looks like JQL is passed through as-is. */
  private buildJql(params: ConnectorSearchParams) {
    const query = params.query.trim();
    if (query !== "*" && looksLikeStructuredQuery(query)) return query;
    const minutes = Math.max(
      1,
      Math.ceil((Date.now() - params.timeWindow.start.getTime()) / 60_000),
    );
    // Relative offsets avoid the site-timezone ambiguity of absolute JQL dates.
    const clauses = [`updated >= "-${minutes}m"`];
    if (query !== "*")
      clauses.unshift(`text ~ "${escapeQuotedQueryText(query)}"`);
    return `${clauses.join(" AND ")} ORDER BY updated DESC`;
  }

  async search(
    params: ConnectorSearchParams,
  ): Promise<ConnectorEvidenceItem[]> {
    const { endpoint, headers, mode } = this.auth();
    const limit = this.resultLimit(params);
    const url = new URL(
      mode === "cloud"
        ? `${endpoint}/rest/api/3/search/jql`
        : `${endpoint}/rest/api/2/search`,
    );
    url.searchParams.set("jql", this.buildJql(params));
    url.searchParams.set("maxResults", String(limit));
    url.searchParams.set("fields", FIELDS);

    const payload = (await knowledgeRequest({
      provider: "Jira",
      url: url.toString(),
      headers,
      timeoutMs: this.timeoutMs(params),
    })) as { issues?: unknown };
    const issues = Array.isArray(payload.issues)
      ? (payload.issues as JiraIssue[])
      : [];

    return issues
      .filter(
        (issue) =>
          typeof issue.key === "string" &&
          /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(issue.key),
      )
      .slice(0, limit)
      .map((issue) => {
        const fields = issue.fields ?? {};
        const key = issue.key as string;
        const description =
          typeof fields.description === "string"
            ? fields.description
            : adfToPlainText(fields.description);
        const status = [
          fields.issuetype?.name,
          fields.status?.name,
          fields.priority?.name,
        ]
          .filter(Boolean)
          .join(" · ");
        const labels = Array.isArray(fields.labels)
          ? fields.labels
              .filter((label): label is string => typeof label === "string")
              .slice(0, 10)
          : [];
        return buildKnowledgeEvidence({
          connectorId: this.id,
          source: "jira",
          provider: "Jira",
          sourceUri: `${endpoint}/browse/${encodeURIComponent(key)}`,
          title: `${key}: ${fields.summary ?? "Jira issue"}`,
          excerpt: [status, description].filter(Boolean).join("\n"),
          timestamp: dateOrFallback(
            fields.updated ?? fields.created,
            params.timeWindow.end,
          ),
          tags: ["ticket", fields.status?.name ?? "", ...labels],
          query: params.query,
          raw: { key, fields },
        });
      });
  }
}
