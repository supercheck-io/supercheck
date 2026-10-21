-- OAuth 2.1 authorization server tables for the remote MCP server (Better Auth
-- jwt, oauth-provider and mcp plugins). Additive only: the plugins that use these
-- tables are registered only when MCP_SERVER_ENABLED=true, so existing behaviour
-- is unchanged. Shapes match db/schema/oauth.ts.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jwks" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "expires_at" timestamp,
  "alg" text,
  "crv" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "client_discovery_id" text,
  "disabled" boolean DEFAULT false,
  "skip_consent" boolean,
  "enable_end_session" boolean,
  "subject_type" text,
  "scopes" text[],
  "client_credentials_scopes" text[] DEFAULT '{}',
  "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp,
  "updated_at" timestamp,
  "name" text,
  "uri" text,
  "icon" text,
  "contacts" text[],
  "tos" text,
  "policy" text,
  "software_id" text,
  "software_version" text,
  "software_statement" text,
  "redirect_uris" text[] NOT NULL,
  "post_logout_redirect_uris" text[],
  "backchannel_logout_uri" text,
  "backchannel_logout_session_required" boolean,
  "token_endpoint_auth_method" text,
  "application_type" text,
  "jwks" text,
  "jwks_uri" text,
  "grant_types" text[],
  "response_types" text[],
  "require_pkce" boolean,
  "dpop_bound_access_tokens" boolean DEFAULT false,
  "reference_id" text,
  "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "oauth_client_user_id_idx" ON "oauth_client" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_resource" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "identifier" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "access_token_ttl" integer,
  "refresh_token_ttl" integer,
  "signing_algorithm" text,
  "signing_key_id" text,
  "allowed_scopes" text[],
  "custom_claims" jsonb,
  "dpop_bound_access_tokens_required" boolean DEFAULT false,
  "disabled" boolean DEFAULT false,
  "created_at" timestamp,
  "updated_at" timestamp,
  "policy_version" integer DEFAULT 1,
  "metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_resource" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "resource_id" text NOT NULL REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE,
  "metadata" jsonb,
  "created_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_client_resource_client_resource_uidx"
  ON "oauth_client_resource" ("client_id", "resource_id");
CREATE INDEX IF NOT EXISTS "oauth_client_resource_client_id_idx" ON "oauth_client_resource" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_client_resource_resource_id_idx" ON "oauth_client_resource" ("resource_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_refresh_token" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "token" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "session"("id") ON DELETE SET NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "authorization_code_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "revoked" timestamp,
  "rotated_at" timestamp,
  "rotation_replay_response" text,
  "rotation_replay_expires_at" timestamp,
  "auth_time" timestamp,
  "confirmation" jsonb,
  "scopes" text[] NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token" ("session_id");
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token" ("user_id");
CREATE INDEX IF NOT EXISTS "oauth_refresh_token_authorization_code_id_idx"
  ON "oauth_refresh_token" ("authorization_code_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_access_token" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "token" text NOT NULL UNIQUE,
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "session_id" uuid REFERENCES "session"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "authorization_code_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "refresh_id" uuid REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "revoked" timestamp,
  "confirmation" jsonb,
  "scopes" text[] NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauth_access_token_client_id_idx" ON "oauth_access_token" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_access_token_session_id_idx" ON "oauth_access_token" ("session_id");
CREATE INDEX IF NOT EXISTS "oauth_access_token_user_id_idx" ON "oauth_access_token" ("user_id");
CREATE INDEX IF NOT EXISTS "oauth_access_token_authorization_code_id_idx"
  ON "oauth_access_token" ("authorization_code_id");
CREATE INDEX IF NOT EXISTS "oauth_access_token_refresh_id_idx" ON "oauth_access_token" ("refresh_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_consent" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "client_id" text NOT NULL REFERENCES "oauth_client"("client_id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
  "reference_id" text,
  "resources" text[],
  "requested_user_info_claims" text[],
  "scopes" text[] NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauth_consent_client_id_idx" ON "oauth_consent" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_consent_user_id_idx" ON "oauth_consent" ("user_id");
-- One connection per (app, user, project): a double-clicked Approve cannot create a second row
-- that disconnecting the first would leave behind. NULL references are distinct, but consent
-- without a project is refused by the application.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_consent_client_user_reference_uidx"
  ON "oauth_consent" ("client_id", "user_id", "reference_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client_assertion" (
  "id" text PRIMARY KEY,
  "expires_at" timestamp NOT NULL
);
