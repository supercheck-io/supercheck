---
name: mcp-server
description: "Use when: developing, reviewing, or troubleshooting the Supercheck Model Context Protocol (MCP) server, managing API keys, handling RBAC for AI agents, or adding new MCP tools."
---

# Supercheck MCP Server Architecture

## Core Design Principles
1. **Read-First, Create-Second**: Prioritize read operations (e.g., `listTests`, `getTestResults`). Write operations are strictly limited to safe creations (e.g., `createTest`, `triggerJob`).
2. **No Destructive Actions**: `update` and `delete` tools are intentionally excluded. Modifications must happen via the Supercheck UI.
3. **Respect RBAC**: MCP operations inherit the permissions of the API Key owner. The API acts as the central source of truth for authorization.
4. **Audit Everything**: All MCP operations must log an `McpAuditLog` covering timestamps, the API key ID, and the outcome, with sensitive payload parameters redacted.

## Authentication & Security
- **API Keys**: AI Assistants use a `SUPERCHECK_API_KEY`. The server validates this key format locally, then forwards it to the Supercheck API via the `Authorization: Bearer` header.
- **Scoping**: Keys can be scoped to the entire Organization, a specific Project, or a specific Job, minimizing the blast radius.
- **Secret Redaction**: 
  - API keys must never be logged or returned in responses.
  - Project variables marked as `isSecret: true` must be returned as `[ENCRYPTED]`.

## Adding New Tools
When adding new tools to the MCP Server, ensure they:
- Follow standard Zod validation for parameters.
- Handle error boundaries gracefully (401, 403, 404, 429, etc.).
- Never bypass the `requireAuthContext()` and `checkPermissionWithContext()` API functions.

## Transports
- **STDIO**: Primary transport for local development (VS Code Copilot, Cursor, Claude Code).
- **HTTP / SSE**: For remote streaming and cloud integrations.
