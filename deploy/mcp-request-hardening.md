# MCP Request Hardening

This guide describes the source request contract; verify the exact deployed release before enabling it. The feature flag remains off by default.

## Request and authorization checks

Each POST rechecks that the OAuth client exists and is enabled, and verifies the
live user, consent, and project access. `list_runs` and `get_run` require
`run:view`; access remains project- and organization-scoped, with allowlisted and
redacted response fields.

The public `Host` is checked against `BETTER_AUTH_URL` before authentication.
Behind Next proxy, the internal request URL is accepted only after the public host
validates; forwarded headers are not trusted. Origin is checked against the
canonical resource origin or the existing shared CORS allowlist, including
configured wildcards. The SDK DNS-rebinding check remains enabled.

Route and authorization errors use JSON-RPC 2.0 with `id: null`. Authentication
responses retain the `WWW-Authenticate` challenge and DPoP nonce. Responses use
`no-store`; invalid JSON returns parse error `-32700`, and infrastructure errors
return a sanitized 503.

Streamable HTTP clients must send `Accept: application/json, text/event-stream`,
including with `enableJsonResponse=true`. JSON-only Accept is not supported and
the protocol requirement is not relaxed.

## Verification boundary

Regression gates cover malformed/untrusted origins, canonical public Host behind an internal Next URL, preserved authentication challenges, JSON-RPC refusals, run permissions, and real PostgreSQL client-disable/deletion and consent revocation. Deployment acceptance still requires the intended proxy/issuer/JWKS path and an authorized MCP client against the exact deployed revision.
