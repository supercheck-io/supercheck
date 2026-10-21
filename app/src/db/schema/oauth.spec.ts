import type { SQL } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { oauthSchema } from "./oauth";

// Better Auth's Drizzle adapter finds each table by its MODEL name, so a rename here breaks the
// OAuth server at runtime (and only when the feature is on). The real-stack checks cover behaviour;
// this pins the names the adapter looks up.
describe("OAuth schema", () => {
  it("is keyed by the model names Better Auth's OAuth provider and JWT plugins use", () => {
    expect(Object.keys(oauthSchema).sort()).toEqual([
      "jwks", "oauthAccessToken", "oauthClient", "oauthClientAssertion", "oauthClientResource",
      "oauthConsent", "oauthRefreshToken", "oauthResource",
    ]);
  });

  it("maps each model to its snake_case table", () => {
    const tables = Object.fromEntries(Object.entries(oauthSchema).map(([model, table]) => [model, getTableConfig(table).name]));
    expect(tables).toEqual({
      jwks: "jwks", oauthClient: "oauth_client", oauthResource: "oauth_resource", oauthClientResource: "oauth_client_resource",
      oauthRefreshToken: "oauth_refresh_token", oauthAccessToken: "oauth_access_token", oauthConsent: "oauth_consent",
      oauthClientAssertion: "oauth_client_assertion",
    });
  });

  it("makes a consent name its project, unique per app, user and project", () => {
    const config = getTableConfig(oauthSchema.oauthConsent);
    expect(config.checks.map((c) => c.name)).toContain("oauth_consent_project_required");
    expect(config.indexes.find((i) => i.config.name === "oauth_consent_client_user_reference_uidx")?.config.unique).toBe(true);
  });

  it("generates its own UUIDv7 keys, so inserts need not supply one", () => {
    for (const [name, table] of Object.entries(oauthSchema)) {
      if (name === "oauthClientAssertion") continue; // keyed by the client assertion's jti
      const idColumn = getTableConfig(table).columns.find((c) => c.name === "id");
      expect(idColumn?.hasDefault).toBe(true);
      // The default is a database-side uuidv7() call, not a client-generated value.
      const fragment = (idColumn as unknown as { defaultFn: () => SQL }).defaultFn();
      expect(new PgDialect().sqlToQuery(fragment).sql).toBe("uuidv7()");
    }
  });
});
