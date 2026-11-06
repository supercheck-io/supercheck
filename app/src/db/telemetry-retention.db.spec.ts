/** @jest-environment node */
// Needs TEST_DATABASE_URL (run with `npm run test:db`). Proves the telemetry retention purge (rules in src/lib/telemetry-retention.ts).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const APP_ROOT = path.resolve(__dirname, "../..");
const maintenanceUrl = process.env.TEST_DATABASE_URL;
if (!maintenanceUrl)
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests.",
  );

const databaseName = `retention_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let maintenance: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  maintenance = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const target = new URL(maintenanceUrl);
  target.pathname = `/${databaseName}`;
  await promisify(execFile)(
    process.execPath,
    [path.join(APP_ROOT, "scripts/db-migrate.js")],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        SELF_HOSTED: "true",
        NODE_ENV: "test",
      },
      timeout: 90_000,
    },
  );
  sql = postgres(target.toString(), { max: 1, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await maintenance?.unsafe(
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
  );
  await maintenance?.end({ timeout: 5 });
});

import {
  TELEMETRY_RETENTION_RULES,
  purgeTelemetryTable,
  type TelemetryRetentionRule,
} from "@/lib/telemetry-retention";

const id = () => randomUUID();
const ago = (days: number) => `now() - interval '${days} days'`;
const rule = (table: string) =>
  TELEMETRY_RETENTION_RULES.find((r) => r.table === table) as TelemetryRetentionRule;
const run = async (statement: string) => [...(await sql.unsafe(statement))];
const purge = (table: string, batchSize = 2) =>
  purgeTelemetryTable(run, rule(table), { batchSize, maxRecords: 1000 });
const ids = async (table: string) =>
  new Set(
    (await sql.unsafe(`SELECT id FROM ${table}`)).map((r) => r.id as string),
  );

// Seed with FK triggers off so only the columns under test need values; purge runs with them on.
async function seed(statements: string[]) {
  await sql.unsafe("SET session_replication_role = replica");
  try {
    for (const s of statements) await sql.unsafe(s);
  } finally {
    await sql.unsafe("SET session_replication_role = DEFAULT");
  }
}

describe("telemetry retention purge", () => {
  it("every rule's time column is served by an index leading with it", async () => {
    for (const r of TELEMETRY_RETENTION_RULES) {
      const rows = await sql.unsafe(
        `SELECT 1 FROM pg_indexes WHERE tablename = '${r.table}' AND indexdef ~ '\\(${r.timeColumn}[,)]'`,
      );
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("heartbeats: deletes old rows in batches but keeps each agent's newest", async () => {
    const [a, b, org] = [id(), id(), id()];
    const old = Array.from({ length: 5 }, () => id());
    const rows = [
      ...old.map((hid, i) => [hid, a, 30 + i]),
      [id(), b, 40], // b's only (and newest) row, old
      [id(), a, 1],
    ];
    await seed(
      rows.map(
        ([hid, agent, days]) =>
          `INSERT INTO private_agent_heartbeats (id, private_agent_id, organization_id, status, protocol_version, agent_version, created_at) VALUES ('${hid}','${agent}','${org}','connected','1','1',${ago(Number(days))})`,
      ),
    );
    const batches: number[] = [];
    const counting = async (s: string) => {
      const rows = await run(s);
      batches.push(Number(rows[0].deleted));
      return rows;
    };
    const deleted = await purgeTelemetryTable(
      counting,
      rule("private_agent_heartbeats"),
      { days: 7, batchSize: 2, maxRecords: 1000 },
    );
    expect(deleted).toBe(5);
    expect(batches).toEqual([2, 2, 1]);
    const left = await ids("private_agent_heartbeats");
    expect(left.size).toBe(2);
    expect(old.some((o) => left.has(o))).toBe(false);
    expect(
      (await sql.unsafe(`SELECT 1 FROM private_agent_heartbeats WHERE private_agent_id = '${b}'`)).length,
    ).toBe(1);
  });

  it("health snapshots keep the latest per service; observations purge by age", async () => {
    const [svc, proj] = [id(), id()];
    const snap = (days: number, service = svc) =>
      `INSERT INTO sre_service_health_snapshots (id, service_id, project_id, health, window_start, window_end) VALUES ('${id()}','${service}','${proj}','healthy',${ago(days + 1)},${ago(days)})`;
    await seed([
      snap(200), snap(150), snap(100), snap(1),
      `INSERT INTO sre_service_dependency_observations (id, source_service_id, target_service_id, observed_by, confidence, observed_at) VALUES ('${id()}','${svc}','${id()}','t',0.5,${ago(200)})`,
      `INSERT INTO sre_service_dependency_observations (id, source_service_id, target_service_id, observed_by, confidence, observed_at) VALUES ('${id()}','${svc}','${id()}','t',0.5,${ago(2)})`,
    ]);
    expect(await purge("sre_service_health_snapshots")).toBe(3);
    expect(await purge("sre_service_dependency_observations")).toBe(1);
    // a service whose only snapshot is old keeps it
    expect((await ids("sre_service_health_snapshots")).size).toBe(1);
    expect((await ids("sre_service_dependency_observations")).size).toBe(1);
    await seed([snap(500, id())]);
    expect(await purge("sre_service_health_snapshots")).toBe(0);
  });

  it("alert events: keeps firing, recent and incident-linked events", async () => {
    const [org, proj, inc] = [id(), id(), id()];
    const ev = (status: string, days: number, fp: string) => {
      const eid = id();
      return [
        eid,
        `INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, status, source_type, title, fired_at) VALUES ('${eid}','${org}','${proj}','${fp}','${status}','monitor','t',${ago(days)})`,
      ] as const;
    };
    const oldResolved = ev("resolved", 200, "a");
    const oldFiring = ev("firing", 200, "b");
    const recent = ev("resolved", 5, "c");
    const linked = ev("resolved", 200, "d");
    await seed([
      oldResolved[1], oldFiring[1], recent[1], linked[1],
      `INSERT INTO sre_incident_alerts (id, incident_id, alert_event_id) VALUES ('${id()}','${inc}','${linked[0]}')`,
    ]);
    expect(await purge("sre_alert_events")).toBe(1);
    const left = await ids("sre_alert_events");
    expect(left.has(oldResolved[0])).toBe(false);
    expect([oldFiring[0], recent[0], linked[0]].every((x) => left.has(x))).toBe(true);
  });

  it("outbox events: purges old expanded events with terminal deliveries only, cascading their deliveries", async () => {
    const [inc, upd, sub] = [id(), id(), id()];
    const mk = (expanded: boolean, days: number, deliveries: string[]) => {
      const eid = id();
      const stmts = [
        `INSERT INTO status_page_notification_events (id, incident_id, update_id, expanded_at, created_at) VALUES ('${eid}','${inc}','${id()}',${expanded ? "now()" : "NULL"},${ago(days)})`,
        ...deliveries.map(
          (st) =>
            `INSERT INTO status_page_notification_deliveries (id, event_id, subscriber_id, mode, status) VALUES ('${id()}','${eid}','${id()}','email','${st}')`,
        ),
      ];
      return [eid, stmts] as const;
    };
    void upd; void sub;
    const done = mk(true, 60, ["delivered", "failed"]);
    const pending = mk(true, 60, ["delivered", "pending"]);
    const unexpanded = mk(false, 60, []);
    const fresh = mk(true, 2, ["delivered"]);
    await seed([done, pending, unexpanded, fresh].flatMap(([, s]) => [...s]));
    expect(await purge("status_page_notification_events")).toBe(1);
    const left = await ids("status_page_notification_events");
    expect(left.has(done[0])).toBe(false);
    expect([pending[0], unexpanded[0], fresh[0]].every((x) => left.has(x))).toBe(true);
    expect(
      (await sql.unsafe(`SELECT 1 FROM status_page_notification_deliveries WHERE event_id = '${done[0]}'`)).length,
    ).toBe(0);
  });

  it("skips rows another transaction holds locked (ingest reusing an alert event)", async () => {
    const [org, proj] = [id(), id()];
    const eid = id();
    await seed([
      `INSERT INTO sre_alert_events (id, organization_id, project_id, fingerprint_hash, status, source_type, title, fired_at) VALUES ('${eid}','${org}','${proj}','locked','resolved','monitor','t',${ago(200)})`,
    ]);
    const other = postgres(process.env.TEST_DATABASE_URL!.replace(/\/[^/]*$/, `/${databaseName}`), { max: 1, onnotice: () => {} });
    try {
      await other.begin(async (tx) => {
        await tx.unsafe(`SELECT id FROM sre_alert_events WHERE id = '${eid}' FOR UPDATE`);
        expect(await purge("sre_alert_events")).toBe(0);
        expect((await ids("sre_alert_events")).has(eid)).toBe(true);
      });
    } finally {
      await other.end({ timeout: 5 });
    }
    expect(await purge("sre_alert_events")).toBe(1);
  });

  it("pages past protected old rows without rescanning them", async () => {
    const org = id();
    const agent = id();
    // 4 old rows for one agent: the newest is protected, 3 deletable, batch size 1
    await seed(
      [40, 39, 38, 37].map(
        (d) =>
          `INSERT INTO private_agent_heartbeats (id, private_agent_id, organization_id, status, protocol_version, agent_version, created_at) VALUES ('${id()}','${agent}','${org}','connected','1','1',${ago(d)})`,
      ),
    );
    const seen: string[] = [];
    const spy = async (s: string) => {
      seen.push(s);
      return run(s);
    };
    const n = await purgeTelemetryTable(spy, rule("private_agent_heartbeats"), { days: 7, batchSize: 1, maxRecords: 100 });
    expect(n).toBe(3);
    expect(seen.slice(1).every((s) => s.includes("> ('"))).toBe(true);
  });

  it("private agent jobs: purges old finished jobs, keeps unfinished ones and each connector's newest", async () => {
    const [org, proj, agent, c1, c2] = [id(), id(), id(), id(), id()];
    const job = (status: string, days: number, connector: string | null) => {
      const jid = id();
      return [
        jid,
        `INSERT INTO private_agent_jobs (id, organization_id, project_id, private_agent_id, connector_id, job_class, status, authorized_by, policy_decision_hash, job_spec_hash, idempotency_key, created_at) VALUES ('${jid}','${org}','${proj}','${agent}',${connector ? `'${connector}'` : "NULL"},'sre_connector_query','${status}','agent','h','h','${jid}',${ago(days)})`,
      ] as const;
    };
    const oldNoConnector = job("completed", 90, null);
    const oldFailedC1 = job("failed", 90, c1);
    const oldCancelledC1 = job("cancelled", 80, c1);
    const newestOldC1 = job("timed_out", 70, c1); // c1's newest, still past the cutoff
    const onlyOldC2 = job("completed", 60, c2); // c2's only job
    const oldQueued = job("queued", 90, c2);
    const recent = job("completed", 2, null);
    const all = [oldNoConnector, oldFailedC1, oldCancelledC1, newestOldC1, onlyOldC2, oldQueued, recent];
    await seed(all.map(([, s]) => s));
    expect(await purge("private_agent_jobs")).toBe(3);
    const left = await ids("private_agent_jobs");
    expect([oldNoConnector, oldFailedC1, oldCancelledC1].some(([x]) => left.has(x))).toBe(false);
    expect([newestOldC1, onlyOldC2, oldQueued, recent].every(([x]) => left.has(x))).toBe(true);
  });

  it("private agent jobs: the last waiter cancels an abandoned job, an earlier one leaves it queued", async () => {
    const [org, proj, agent] = [id(), id(), id()];
    const jid = id();
    await seed([
      `INSERT INTO private_agent_jobs (id, organization_id, project_id, private_agent_id, job_class, status, authorized_by, policy_decision_hash, job_spec_hash, idempotency_key, waiters) VALUES ('${jid}','${org}','${proj}','${agent}','sre_connector_query','queued','agent','h','h','${jid}',2)`,
    ]);
    const release = async () => {
      const [row] = await sql.unsafe(
        `UPDATE private_agent_jobs SET waiters = GREATEST(waiters - 1, 0), status = CASE WHEN waiters <= 1 AND status = 'queued' THEN 'cancelled' ELSE status END WHERE id = '${jid}' RETURNING status, waiters`,
      );
      return row;
    };
    expect(await release()).toMatchObject({ status: "queued", waiters: 1 });
    expect(await release()).toMatchObject({ status: "cancelled", waiters: 0 });
  });

  it("incident history cascades from its parent and is not covered by any rule", async () => {
    expect(TELEMETRY_RETENTION_RULES.map((r) => r.table)).not.toEqual(
      expect.arrayContaining(["sre_incident_timeline_events"]),
    );
    expect(TELEMETRY_RETENTION_RULES.map((r) => r.table)).not.toContain("sre_chat_messages");
    const rules = await sql`
      SELECT c.conrelid::regclass::text AS tbl, c.confrelid::regclass::text AS parent, c.confdeltype AS del
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.conrelid::regclass::text IN ('sre_incident_timeline_events','sre_chat_messages')`;
    const cascades = rules.filter((r) => r.del === "c").map((r) => `${r.tbl}->${r.parent}`);
    expect(cascades).toEqual(
      expect.arrayContaining([
        "sre_incident_timeline_events->sre_incidents",
        "sre_chat_messages->sre_chat_conversations",
      ]),
    );
  });
});
