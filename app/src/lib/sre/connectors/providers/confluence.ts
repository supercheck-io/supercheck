import type {
  ConnectorEvidenceItem,
  ConnectorMetadata,
  ConnectorSearchParams,
} from "../connector-base";
import { atlassianAuth } from "./atlassian-auth";
import {
  KNOWLEDGE_MAX_BODY_FETCHES,
  KnowledgeConnector,
  buildKnowledgeEvidence,
  escapeQuotedQueryText,
  htmlToPlainText,
  knowledgeRequest,
  looksLikeStructuredQuery,
  sameOriginBase,
  stripSearchHighlights,
  type KnowledgeConnectorOptions,
} from "./knowledge-shared";

type ConfluenceHit = {
  content?: {
    id?: string;
    type?: string;
    title?: string;
    _links?: { webui?: string };
  };
  title?: string;
  excerpt?: string;
  url?: string;
  lastModified?: string;
};

export class ConfluenceConnector extends KnowledgeConnector {
  constructor(
    options: Omit<
      KnowledgeConnectorOptions,
      "type" | "surfaces" | "evidenceTypes" | "requires"
    >,
  ) {
    super({
      ...options,
      type: "confluence",
      surfaces: ["docs"],
      evidenceTypes: ["document"],
      requires: ["credentials", "service_scope"],
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Confluence",
      description: "Read-only search of runbooks and post-mortems.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  private auth() {
    let endpoint = this.requireEndpoint("Confluence");
    const auth = atlassianAuth(
      "Confluence",
      endpoint,
      this.token(),
      this.email(),
    );
    // Cloud serves Confluence under /wiki; accept the bare site URL too.
    if (auth.mode === "cloud" && !/\/wiki$/.test(endpoint))
      endpoint = `${endpoint}/wiki`;
    return { endpoint, ...auth };
  }

  protected validationRequest() {
    const { endpoint, headers } = this.auth();
    return knowledgeRequest({
      provider: "Confluence",
      url: `${endpoint}/rest/api/space?limit=1`,
      headers,
      timeoutMs: this.timeoutMs(),
    });
  }

  private buildCql(query: string) {
    const trimmed = query.trim();
    if (trimmed !== "*" && looksLikeStructuredQuery(trimmed)) return trimmed;
    const text =
      trimmed === "*" ? "" : `text ~ "${escapeQuotedQueryText(trimmed)}" AND `;
    return `${text}type in (page, blogpost) ORDER BY lastmodified DESC`;
  }

  private async fetchBody(
    endpoint: string,
    headers: Record<string, string>,
    mode: "cloud" | "data_center",
    hit: ConfluenceHit,
    timeoutMs: number,
  ) {
    const id = hit.content?.id;
    if (!id || !/^\d{1,20}$/.test(id)) return null;
    const url =
      mode === "cloud"
        ? `${endpoint}/api/v2/${hit.content?.type === "blogpost" ? "blogposts" : "pages"}/${id}?body-format=storage`
        : `${endpoint}/rest/api/content/${id}?expand=body.storage`;
    try {
      const payload = (await knowledgeRequest({
        provider: "Confluence",
        url,
        headers,
        timeoutMs,
      })) as {
        body?: { storage?: { value?: unknown } };
      };
      const value = payload.body?.storage?.value;
      return typeof value === "string" ? htmlToPlainText(value) : null;
    } catch (error) {
      // A rejected credential must surface; a single unreadable page degrades to its excerpt.
      if (
        error instanceof Error &&
        error.message.includes("credentials rejected")
      )
        throw error;
      return null;
    }
  }

  async search(
    params: ConnectorSearchParams,
  ): Promise<ConnectorEvidenceItem[]> {
    const { endpoint, headers, mode } = this.auth();
    const limit = this.resultLimit(params);
    const url = new URL(`${endpoint}/rest/api/search`);
    url.searchParams.set("cql", this.buildCql(params.query));
    url.searchParams.set("limit", String(limit));
    const timeoutMs = this.timeoutMs(params);
    const deadline = Date.now() + timeoutMs;

    const payload = (await knowledgeRequest({
      provider: "Confluence",
      url: url.toString(),
      headers,
      timeoutMs,
    })) as { results?: unknown; _links?: { base?: string } };
    const hits = (
      Array.isArray(payload.results) ? (payload.results as ConfluenceHit[]) : []
    ).slice(0, limit);
    const base = sameOriginBase(payload._links?.base, endpoint);

    // One shared deadline: body fetches get only what the search left.
    const remainingMs = deadline - Date.now();
    const bodies = await Promise.all(
      hits.map((hit, index) =>
        remainingMs > 250 && index < KNOWLEDGE_MAX_BODY_FETCHES
          ? this.fetchBody(endpoint, headers, mode, hit, remainingMs)
          : Promise.resolve(null),
      ),
    );

    return hits.map((hit, index) => {
      const path = hit.url ?? hit.content?._links?.webui ?? "";
      const title = hit.content?.title ?? hit.title ?? "Confluence page";
      return buildKnowledgeEvidence({
        connectorId: this.id,
        source: "confluence",
        provider: "Confluence",
        sourceUri: path.startsWith("/") ? `${base}${path}` : base,
        title,
        excerpt: stripSearchHighlights(htmlToPlainText(hit.excerpt ?? "", 500)),
        body: bodies[index],
        // Reference docs are relevant regardless of age: observe at retrieval time so briefs keep them.
        timestamp: params.timeWindow.end,
        tags: ["runbook-or-postmortem", hit.content?.type ?? "page"],
        query: params.query,
        raw: { id: hit.content?.id, title, lastModified: hit.lastModified },
      });
    });
  }
}
