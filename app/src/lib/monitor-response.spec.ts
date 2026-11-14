/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
import { PgDialect } from "drizzle-orm/pg-core";
import { HEARTBEAT_ANCHOR_ON_RESUME, MONITOR_READ_COLUMNS, monitorForResponse, WITHOUT_HEARTBEAT_TOKEN } from "./monitor-response";

const base = {
  id: "m1", type: "heartbeat", status: "up", enabled: true, frequencyMinutes: 60, config: null, createdAt: "2026-01-01T00:00:00.000Z",
  heartbeatTokenHash: "hash-secret", heartbeatTokenEncrypted: "cipher-secret",
  heartbeatState: { lastPingAt: "2026-01-01T10:00:00.000Z", lastPingKind: "ping" as const, lastUserAgent: "agent", leaseUntil: "x" },
};

describe("monitorForResponse (B7)", () => {
  it("drops the token columns and the raw runtime state and adds the summary", () => {
    const out = monitorForResponse(base);
    const json = JSON.stringify(out);
    for (const leaked of ["heartbeatTokenHash", "heartbeatTokenEncrypted", "hash-secret", "cipher-secret", "heartbeatState", "leaseUntil", "agent"]) {
      expect(json).not.toContain(leaked);
    }
    expect(out.heartbeat).toMatchObject({ lastPingAt: "2026-01-01T10:00:00.000Z", lastPingKind: "ping" });
  });

  it("leaves other monitors without a heartbeat key in JSON", () => {
    const out = JSON.parse(JSON.stringify(monitorForResponse({ ...base, type: "http_request" })));
    expect(out).not.toHaveProperty("heartbeat");
    expect(out).not.toHaveProperty("heartbeatTokenHash");
  });

  it("exposes column sets without the token columns", () => {
    expect(Object.keys(MONITOR_READ_COLUMNS)).not.toEqual(expect.arrayContaining(["heartbeatTokenHash"]));
    expect(MONITOR_READ_COLUMNS).not.toHaveProperty("heartbeatTokenEncrypted");
    expect(MONITOR_READ_COLUMNS).toHaveProperty("heartbeatState");
    expect(WITHOUT_HEARTBEAT_TOKEN).toEqual({ heartbeatTokenHash: false, heartbeatTokenEncrypted: false });
  });

  it("anchors only heartbeat rows, as an expression on the stored value", () => {
    const { sql } = new PgDialect().sqlToQuery(HEARTBEAT_ANCHOR_ON_RESUME);
    expect(sql).toContain(`CASE WHEN "monitors"."type" = 'heartbeat'`);
    expect(sql).toContain(`coalesce("monitors"."heartbeat_state", '{}'::jsonb) || jsonb_build_object('anchorAt', to_jsonb(now()))`);
    expect(sql).toContain(`ELSE "monitors"."heartbeat_state" END`);
  });
});
