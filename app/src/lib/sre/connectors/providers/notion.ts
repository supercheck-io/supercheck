import type {
  ConnectorEvidenceItem,
  ConnectorMetadata,
  ConnectorSearchParams,
} from "../connector-base";
import {
  KNOWLEDGE_MAX_BODY_CHARS,
  KNOWLEDGE_MAX_BODY_FETCHES,
  KnowledgeConnector,
  buildKnowledgeEvidence,
  knowledgeRequest,
  truncateText,
  type KnowledgeConnectorOptions,
} from "./knowledge-shared";

const NOTION_API = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";
const NOTION_ID =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

type RichText = { plain_text?: unknown };
type NotionPage = {
  id?: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, { type?: string; title?: RichText[] }>;
};

function richTextToString(value: unknown) {
  return Array.isArray(value)
    ? (value as RichText[])
        .map((part) =>
          typeof part.plain_text === "string" ? part.plain_text : "",
        )
        .join("")
    : "";
}

function pageTitle(page: NotionPage) {
  const property = Object.values(page.properties ?? {}).find(
    (entry) => entry?.type === "title",
  );
  return richTextToString(property?.title).trim() || "Untitled Notion page";
}

/** Notion is SaaS-only: the endpoint is fixed, so a stored URL can never redirect the token. */
export class NotionConnector extends KnowledgeConnector {
  constructor(
    options: Omit<
      KnowledgeConnectorOptions,
      "type" | "surfaces" | "evidenceTypes" | "requires"
    >,
  ) {
    super({
      ...options,
      type: "notion",
      surfaces: ["docs"],
      evidenceTypes: ["document"],
      requires: ["credentials", "service_scope"],
      endpointUrl: NOTION_API,
    });
  }

  metadata(): ConnectorMetadata {
    return {
      id: this.id,
      type: this.type,
      displayName: "Notion",
      description:
        "Read-only search of runbooks and incident notes shared with the integration.",
      surfaces: this.surfaces,
      evidenceTypes: this.evidenceTypes,
      requires: this.requires,
    };
  }

  private headers() {
    const token = this.token();
    if (!token) {
      throw new Error(
        "invalid credentials: Notion requires an internal integration token",
      );
    }
    return {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    };
  }

  protected validationRequest() {
    return knowledgeRequest({
      provider: "Notion",
      url: `${NOTION_API}/v1/users/me`,
      headers: this.headers(),
      timeoutMs: this.timeoutMs(),
    });
  }

  private async fetchBody(id: string, timeoutMs: number) {
    if (!NOTION_ID.test(id)) return null;
    try {
      const payload = (await knowledgeRequest({
        provider: "Notion",
        url: `${NOTION_API}/v1/blocks/${id}/children?page_size=50`,
        headers: this.headers(),
        timeoutMs,
      })) as { results?: unknown };
      const blocks = Array.isArray(payload.results) ? payload.results : [];
      const lines = blocks.map((block) => {
        const entry = block as Record<string, unknown>;
        const type = typeof entry.type === "string" ? entry.type : "";
        const content = type
          ? (entry[type] as { rich_text?: unknown } | undefined)
          : undefined;
        return richTextToString(content?.rich_text);
      });
      return truncateText(
        lines.filter(Boolean).join("\n"),
        KNOWLEDGE_MAX_BODY_CHARS,
      );
    } catch (error) {
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
    const limit = this.resultLimit(params);
    const timeoutMs = this.timeoutMs(params);
    // Query-builder hints (type:/source:) are not Notion search syntax.
    const query = params.query
      .replace(/\b(?:type|source):\S+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const payload = (await knowledgeRequest({
      provider: "Notion",
      url: `${NOTION_API}/v1/search`,
      method: "POST",
      headers: this.headers(),
      timeoutMs,
      body: {
        ...(query === "*" || !query ? {} : { query }),
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: limit,
      },
    })) as { results?: unknown };
    const pages = (
      Array.isArray(payload.results) ? (payload.results as NotionPage[]) : []
    ).slice(0, limit);

    const bodies = await Promise.all(
      pages.map((page, index) =>
        index < KNOWLEDGE_MAX_BODY_FETCHES && page.id
          ? this.fetchBody(page.id, timeoutMs)
          : Promise.resolve(null),
      ),
    );

    return pages.map((page, index) => {
      const title = pageTitle(page);
      return buildKnowledgeEvidence({
        connectorId: this.id,
        source: "notion",
        provider: "Notion",
        sourceUri:
          page.url ??
          `https://www.notion.so/${(page.id ?? "").replace(/-/g, "")}`,
        title,
        excerpt: (bodies[index] || title).slice(0, 500),
        body: bodies[index],
        timestamp: params.timeWindow.end,
        tags: ["runbook-or-notes"],
        query: params.query,
        raw: { id: page.id, title, last_edited_time: page.last_edited_time },
      });
    });
  }
}
