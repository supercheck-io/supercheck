/* ================================
   OAUTH 2.1 / MCP SCHEMA
   -------------------------------
   Tables Better Auth's JWT, OAuth provider and MCP plugins read and write.
   Shapes follow `npx auth generate` for the installed Better Auth version; keys
   are UUIDv7 like the rest of the auth schema. `client_id` is text because it
   is chosen by the client (a Client ID Metadata Document URL, for example),
   and so is the client-assertion `jti`.

   The tables always exist, but the plugins that use them are registered only
   when MCP_SERVER_ENABLED=true (see utils/auth.ts).
=================================== */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { session, user } from "./auth";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => sql`uuidv7()`);

/** Signing keys for access tokens (jwt plugin). */
export const jwks = pgTable("jwks", {
  id: id(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

/** Registered OAuth clients: DCR, admin-created, or resolved from a CIMD URL. */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: id(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    userIdIdx: index("oauth_client_user_id_idx").on(table.userId),
  }),
);

/** Protected resources (the MCP endpoint) tokens can be audience-bound to. */
export const oauthResource = pgTable("oauth_resource", {
  id: id(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at"),
  },
  (table) => ({
    clientResourceUnique: uniqueIndex("oauth_client_resource_client_resource_uidx").on(
      table.clientId,
      table.resourceId,
    ),
    clientIdx: index("oauth_client_resource_client_id_idx").on(table.clientId),
    resourceIdx: index("oauth_client_resource_resource_id_idx").on(table.resourceId),
  }),
);

export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: id(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    authTime: timestamp("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    clientIdx: index("oauth_refresh_token_client_id_idx").on(table.clientId),
    sessionIdx: index("oauth_refresh_token_session_id_idx").on(table.sessionId),
    userIdx: index("oauth_refresh_token_user_id_idx").on(table.userId),
    authorizationCodeIdx: index("oauth_refresh_token_authorization_code_id_idx").on(
      table.authorizationCodeId,
    ),
  }),
);

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: id(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: uuid("refresh_id").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => ({
    clientIdx: index("oauth_access_token_client_id_idx").on(table.clientId),
    sessionIdx: index("oauth_access_token_session_id_idx").on(table.sessionId),
    userIdx: index("oauth_access_token_user_id_idx").on(table.userId),
    authorizationCodeIdx: index("oauth_access_token_authorization_code_id_idx").on(
      table.authorizationCodeId,
    ),
    refreshIdx: index("oauth_access_token_refresh_id_idx").on(table.refreshId),
  }),
);

/**
 * A user's grant of scopes to a client. For MCP, `reference_id` is the project
 * the user chose, so one client can be connected to several projects, and
 * revoking a consent revokes exactly one connection.
 */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => ({
    clientIdx: index("oauth_consent_client_id_idx").on(table.clientId),
    userIdx: index("oauth_consent_user_id_idx").on(table.userId),
  }),
);

/** Replay protection for private_key_jwt client assertions; `id` is the JWT `jti`. */
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
});

/** Model-name keyed tables for Better Auth's Drizzle adapter. */
export const oauthSchema = {
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion,
};
