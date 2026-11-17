/**
 * Real-PostgreSQL tests for the heartbeat sweep (spec B10-B12). Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is
 * set: leases, SKIP LOCKED and a ping racing an evaluation cannot be shown with a mock. Migrations are the app's own.
 */
import { and, eq } from 'drizzle-orm';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';
import type { DbService } from '../../db/db.service';
import { createTestDatabase } from '../../monitor-control/pg-test-database';
import {
  MonitorAlertService,
  warningEpisodeUuid,
} from '../services/monitor-alert.service';
import { MonitorService } from '../monitor.service';
import {
  HEARTBEAT_INGEST_KEY,
  HeartbeatSweepService,
} from './heartbeat-sweep.service';

jest.mock('../../common/notification-provider-crypto', () => ({
  decryptNotificationProviderConfig: jest.fn((config) => config),
}));
jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('heartbeat sweep (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let organizationId: string;
  let projectId: string;
  let customProvider: string;
  let presetProvider: string;

  let sendDelayMs = 0;
  let onSend: (() => void) | undefined;
  const sent: string[] = [];
  const notificationService = {
    sendNotificationToMultipleProviders: jest.fn(
      async (providers: Array<{ id: string }>, payload: { type: string }) => {
        onSend?.();
        if (sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
        for (const provider of providers)
          sent.push(`${payload.type}:${provider.id}`);
        return {
          success: providers.length,
          failed: 0,
          results: providers.map((provider) => ({ provider, success: true })),
        };
      },
    ),
  };
  const triage = {
    enqueueAlertHistoryRows: jest.fn().mockResolvedValue(undefined),
    enqueueSourceRecovery: jest.fn().mockResolvedValue(true),
    enqueueSourceFailure: jest.fn().mockResolvedValue(true),
  };
  const usage = {
    shouldBlockExecution: jest.fn().mockResolvedValue({ blocked: false }),
  };
  const redis = {
    status: 'ready',
    get: jest.fn(async (key: string) =>
      key === HEARTBEAT_INGEST_KEY ? String(Date.now()) : null,
    ),
    set: jest.fn(),
    eval: jest.fn(async () => [0, '']),
  };

  /** Each call is a separate worker process with its own services, on the same database. */
  const newSweep = () => {
    const dbService = { db } as unknown as DbService;
    const alerts = new MonitorAlertService(
      dbService,
      { get: () => 'https://app.example.com' } as never,
      notificationService as never,
      triage as never,
    );
    const unused = {} as never;
    const monitorService = new MonitorService(
      dbService,
      unused,
      alerts,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      usage as never,
      unused,
      unused,
    );
    return new HeartbeatSweepService(
      dbService,
      { getClient: () => redis } as never,
      usage as never,
      monitorService,
      alerts,
    );
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    ({ client, db } = testDb);
  });
  afterAll(async () => {
    if (testDb) await testDb.drop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    usage.shouldBlockExecution.mockResolvedValue({ blocked: false });
    sent.length = 0;
    sendDelayMs = 0;
    onSend = undefined;
    await client`TRUNCATE monitors, organization CASCADE`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: 'Org', createdAt: new Date() })
      .returning();
    organizationId = org.id;
    const [project] = await db
      .insert(schema.projects)
      .values({ organizationId, name: 'Project' })
      .returning();
    projectId = project.id;
    const providers = await db
      .insert(schema.notificationProviders)
      .values([
        {
          organizationId,
          projectId,
          name: 'custom',
          type: 'webhook' as const,
          config: { url: 'https://hooks.example.com/custom' } as never,
        },
        {
          organizationId,
          projectId,
          name: 'pager',
          type: 'webhook' as const,
          config: {
            url: 'https://events.pagerduty.com/v2/enqueue',
            preset: 'pagerduty',
          } as never,
        },
      ])
      .returning();
    [customProvider, presetProvider] = providers.map((p) => p.id);
  });

  /** A heartbeat monitor, 60 min interval (grace 12 min). `pingAgoMin` seeds an evaluated ping that long ago. */
  async function seedHeartbeat(
    over: {
      status?: 'pending' | 'up' | 'down' | 'paused';
      pingAgoMin?: number;
      enabled?: boolean;
      warnings?: boolean;
    } = {},
  ) {
    const now = Date.now();
    const pinged = over.pingAgoMin !== undefined;
    const [monitor] = await db
      .insert(schema.monitors)
      .values({
        organizationId,
        projectId,
        name: 'Nightly backup',
        type: 'heartbeat',
        target: '',
        frequencyMinutes: 60,
        status: over.status ?? (pinged ? 'up' : 'pending'),
        enabled: over.enabled ?? true,
        createdAt: new Date(now - 7 * 24 * 60 * 60_000),
        heartbeatState: {
          anchorAt: new Date(now - 7 * 24 * 60 * 60_000).toISOString(),
          ...(pinged
            ? {
                lastPingAt: new Date(
                  now - over.pingAgoMin! * 60_000,
                ).toISOString(),
                lastPingKind: 'ping' as const,
                pingSeq: 1,
                evaluatedSeq: 1,
              }
            : {}),
        },
        alertConfig: {
          enabled: true,
          notificationProviders: [customProvider, presetProvider],
          alertOnFailure: true,
          alertOnRecovery: true,
          failureThreshold: 1,
          recoveryThreshold: 1,
          incidentEnabled: true,
          incidentSeverity: 'sev2',
          autoResolveIncident: true,
          warnings: { heartbeat_late: over.warnings ?? false },
        },
      })
      .returning();
    await db.insert(schema.monitorNotificationSettings).values(
      [customProvider, presetProvider].map((notificationProviderId) => ({
        monitorId: monitor.id,
        notificationProviderId,
      })),
    );
    return monitor.id;
  }

  /** The app's ping statement (app/src/lib/heartbeat/ping.ts), by monitor id, on its own connection. */
  async function ping(
    monitorId: string,
    kind: 'ping' | 'fail' | 'start' = 'ping',
    sqlClient = client,
  ) {
    const patch =
      kind === 'start'
        ? sqlClient`jsonb_build_object('lastStartAt', to_jsonb(now()))`
        : sqlClient`jsonb_strip_nulls(jsonb_build_object(
            'lastPingAt', to_jsonb(now()),
            'lastPingKind', ${kind}::text,
            'pingSeq', coalesce((m.heartbeat_state->>'pingSeq')::bigint, 0) + 1,
            'failSeq', CASE WHEN ${kind} = 'fail' THEN coalesce((m.heartbeat_state->>'failSeq')::bigint, 0) + 1 END,
            'lastFailAt', CASE WHEN ${kind} = 'fail' THEN to_jsonb(now()) END,
            'lastUserAgent', 'curl/8'::text))`;
    await sqlClient`
      UPDATE monitors AS m
      SET heartbeat_state = coalesce(m.heartbeat_state, '{}'::jsonb) || ${patch}
      WHERE m.id = ${monitorId} AND m.type = 'heartbeat' AND m.enabled = true
        AND m.status <> 'paused' AND m.deleting_at IS NULL`;
  }

  const monitorRow = async (id: string) =>
    (
      await db.select().from(schema.monitors).where(eq(schema.monitors.id, id))
    )[0];
  const results = (id: string) =>
    db
      .select()
      .from(schema.monitorResults)
      .where(eq(schema.monitorResults.monitorId, id))
      .orderBy(schema.monitorResults.checkedAt);
  const alerts = (id: string, type: string) =>
    db
      .select()
      .from(schema.alertHistory)
      .where(
        and(
          eq(schema.alertHistory.monitorId, id),
          eq(schema.alertHistory.type, type as never),
        ),
      );
  const setState = (id: string, patch: Record<string, unknown>) =>
    client`UPDATE monitors SET heartbeat_state = heartbeat_state || ${JSON.stringify(patch)}::jsonb WHERE id = ${id}`;

  it('moves pending to up on the first ping without alerting, and releases the lease', async () => {
    const id = await seedHeartbeat();
    await newSweep().sweep();
    expect(await results(id)).toHaveLength(0); // never pinged: stays pending

    await ping(id, 'start');
    await ping(id);
    await newSweep().sweep();

    const rows = await results(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'up',
      isUp: true,
      location: 'local',
    });
    expect(rows[0].details).toMatchObject({
      heartbeat: { kind: 'ping', userAgent: 'curl/8' },
    });
    expect(rows[0].responseTimeMs).not.toBeNull();
    const monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState).toMatchObject({
      pingSeq: 1,
      evaluatedSeq: 1,
    });
    expect(monitor.heartbeatState?.leaseUntil).toBeUndefined();
    // finish() strips nulls, so an unheld state carries no `missHeld` key at all.
    expect(monitor.heartbeatState).not.toHaveProperty('missHeld');
    expect(sent).toEqual([]);
  });

  it('writes one missed down row per interval, alerts monitor_failure and queues the sev2 incident', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 60 + 12 + 1 });
    await newSweep().sweep();

    let rows = await results(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'down', isUp: false });
    expect(rows[0].details).toMatchObject({ heartbeat: { kind: 'missed' } });
    expect((await monitorRow(id)).status).toBe('down');
    expect((await monitorRow(id)).heartbeatState).not.toHaveProperty(
      'missHeld',
    );
    // Failure alerts reach every channel, preset ones included; triage gets the rows (the app opens the sev2).
    expect(sent.sort()).toEqual(
      [
        `monitor_failure:${customProvider}`,
        `monitor_failure:${presetProvider}`,
      ].sort(),
    );
    expect(triage.enqueueAlertHistoryRows).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: 'sent' })]),
    );
    expect((await monitorRow(id)).alertConfig?.incidentSeverity).toBe('sev2');

    // Same interval: no second row, and the monitor is not even claimed.
    await newSweep().sweep();
    expect(await results(id)).toHaveLength(1);

    // One interval later: the next missed row.
    await setState(id, {
      lastMissedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
    });
    await newSweep().sweep();
    rows = await results(id);
    expect(rows).toHaveLength(2);
    expect(rows[1].consecutiveFailureCount).toBe(2);
  });

  it('recovers on the next ping: recovery alert and incident resolve signal', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    await newSweep().sweep();
    expect((await monitorRow(id)).status).toBe('down');
    sent.length = 0;

    await ping(id);
    await newSweep().sweep();

    const monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState?.evaluatedSeq).toBe(2);
    expect(sent).toContain(`monitor_recovery:${customProvider}`);
    expect(triage.enqueueSourceRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'monitor', sourceId: id }),
    );
  });

  it('/fail goes down at once', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 5 });
    await ping(id, 'fail');
    await newSweep().sweep();

    const [row] = await results(id);
    expect(row).toMatchObject({ status: 'down', isUp: false });
    expect(row.details).toMatchObject({
      heartbeat: { kind: 'fail' },
      errorMessage: 'Job reported failure',
    });
    expect((await monitorRow(id)).status).toBe('down');
    expect(sent).toContain(`monitor_failure:${customProvider}`);
  });

  it('drops a miss computed before a pause and resume', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    const sweep = newSweep();
    const realClaim = sweep.claim.bind(sweep);
    jest.spyOn(sweep, 'claim').mockImplementationOnce(async (detect) => {
      const claimed = await realClaim(detect);
      // The app resumes: status pending and a fresh anchor (spec write path).
      await client`UPDATE monitors SET status = 'pending', heartbeat_state = heartbeat_state || jsonb_build_object('anchorAt', to_jsonb(now())) WHERE id = ${id}`;
      return claimed;
    });
    await sweep.sweep();
    expect(await results(id)).toHaveLength(0);
    expect(sent).toEqual([]);
    expect((await monitorRow(id)).heartbeatState?.leaseUntil).toBeUndefined();
  });

  it('the first miss after a resume alerts even with counters used up before the pause', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80, status: 'pending' });
    // Down before the pause, with the 3-alert cap reached in an old outage.
    await db.insert(schema.monitorResults).values({
      monitorId: id,
      location: 'local',
      status: 'down',
      isUp: false,
      checkedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
      consecutiveFailureCount: 40,
      alertsSentForFailure: 3,
      details: { outageKey: '00000000-0000-4000-8000-000000000001' },
    });
    await newSweep().sweep();
    const rows = await results(id);
    expect(rows[1]).toMatchObject({ isUp: false, consecutiveFailureCount: 1 });
    expect((rows[1].details as { outageKey?: string }).outageKey).not.toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(sent).toContain(`monitor_failure:${customProvider}`);
  });

  it('a miss held by maintenance alerts as soon as the window ends, not one interval later', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    const window = (from: Date, to: Date) =>
      client`INSERT INTO maintenance_windows (id, organization_id, project_id, title, scope, recurrence, timezone, local_start_time, duration_minutes, starts_on, occurrence_starts_at, occurrence_ends_at)
        VALUES (uuidv7(), ${organizationId}, ${projectId}, 'Deploy', 'project', 'once', 'UTC', '10:00', 60, '2026-10-21',
          ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`;
    try {
      await window(
        new Date(Date.now() - 60 * 60_000),
        new Date(Date.now() + 60 * 60_000),
      );
      await newSweep().sweep();
      expect(await results(id)).toHaveLength(1);
      expect(sent).toEqual([]);
      expect((await monitorRow(id)).heartbeatState?.missHeld).toBe(true);

      // Still inside the window: no second row, and the lease is kept so the row is not re-claimed every tick.
      await setState(id, {
        leaseUntil: new Date(Date.now() - 1000).toISOString(),
      });
      await newSweep().sweep();
      expect(await results(id)).toHaveLength(1);
      expect((await monitorRow(id)).heartbeatState?.leaseUntil).toBeDefined();
      await setState(id, {
        leaseUntil: new Date(Date.now() - 1000).toISOString(),
      });

      await client`UPDATE maintenance_windows SET occurrence_ends_at = now() - interval '1 second'`;
      await newSweep().sweep();
      const rows = await results(id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        isUp: false,
        consecutiveFailureCount: 1,
      });
      expect(sent).toContain(`monitor_failure:${customProvider}`);
      expect((await monitorRow(id)).heartbeatState?.missHeld).toBeUndefined();

      // Back to one missed row per interval.
      await newSweep().sweep();
      expect(await results(id)).toHaveLength(2);
    } finally {
      await client`DELETE FROM maintenance_windows`;
    }
  });

  /** /fail then ping, and an earlier attempt that stored the fail row and died before its status write. */
  async function partialFailThenPing() {
    const id = await seedHeartbeat({ pingAgoMin: 5 });
    await ping(id, 'fail');
    await ping(id);
    const { lastFailAt } = (await monitorRow(id)).heartbeatState ?? {};
    const outageKey = '00000000-0000-4000-8000-0000000000aa';
    await db.insert(schema.monitorResults).values({
      monitorId: id,
      location: 'local',
      status: 'down',
      isUp: false,
      checkedAt: new Date(lastFailAt!),
      consecutiveFailureCount: 1,
      isStatusChange: true,
      details: { heartbeat: { kind: 'fail' }, outageKey },
    });
    return { id, outageKey };
  }

  it('a retry after a partial /fail-then-ping stores the failure once and still alerts it once', async () => {
    const { id } = await partialFailThenPing();
    await newSweep().sweep();
    expect((await results(id)).map((r) => r.isUp)).toEqual([false, true]);
    // Exactly once per channel.
    expect(sent.filter((x) => x.startsWith('monitor_failure:')).sort()).toEqual(
      [
        `monitor_failure:${customProvider}`,
        `monitor_failure:${presetProvider}`,
      ].sort(),
    );
    expect(sent).toContain(`monitor_recovery:${customProvider}`);
    expect((await monitorRow(id)).status).toBe('up');
  });

  it('a retry after a partial /fail-then-ping whose failure alert already went out does not send it again', async () => {
    const { id, outageKey } = await partialFailThenPing();
    await db.insert(schema.alertHistory).values(
      [customProvider, presetProvider].map((provider) => ({
        type: 'monitor_failure' as const,
        message: 'down',
        target: 'Nightly backup',
        targetType: 'monitor',
        monitorId: id,
        provider,
        status: 'sent' as const,
        sentAt: new Date(),
        outageKey,
        alertOrdinal: 0,
        claimAttempts: 1,
      })),
    );
    await newSweep().sweep();
    expect(sent.some((x) => x.startsWith('monitor_failure:'))).toBe(false);
    expect(sent).toContain(`monitor_recovery:${customProvider}`);
    expect((await results(id)).map((r) => r.isUp)).toEqual([false, true]);
  });

  it('a /fail then a ping in one sweep window: down + failure alert, then up + recovery', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 5 });
    await ping(id, 'fail');
    await ping(id);
    await newSweep().sweep();

    const rows = await results(id);
    expect(
      rows.map((r) => [
        r.isUp,
        (r.details as { heartbeat?: { kind?: string } }).heartbeat?.kind,
      ]),
    ).toEqual([
      [false, 'fail'],
      [true, 'ping'],
    ]);
    expect(sent).toEqual(
      expect.arrayContaining([
        `monitor_failure:${customProvider}`,
        `monitor_recovery:${customProvider}`,
      ]),
    );
    const monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState).toMatchObject({
      pingSeq: 3,
      evaluatedSeq: 3,
      failSeq: 1,
      evaluatedFailSeq: 1,
    });

    // Judged once: the next ping records only an up row.
    await ping(id);
    await newSweep().sweep();
    expect((await results(id)).map((r) => r.isUp)).toEqual([false, true, true]);
  });

  it('late inside grace sends heartbeat_late once to non-preset channels only, with no incident', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 65, warnings: true });
    await newSweep().sweep();

    expect(sent).toEqual([`monitor_warning:${customProvider}`]);
    const [warning] = await alerts(id, 'monitor_warning');
    expect(warning).toMatchObject({
      provider: customProvider,
      status: 'sent',
      alertOrdinal: 0,
    });
    const { lateEpisodeKey } = (await monitorRow(id)).heartbeatState ?? {};
    expect(lateEpisodeKey).toMatch(new RegExp(`^heartbeat_late:${id}:`));
    expect(warning.outageKey).toBe(warningEpisodeUuid(lateEpisodeKey!));
    expect(triage.enqueueAlertHistoryRows).not.toHaveBeenCalled();
    expect(triage.enqueueSourceFailure).not.toHaveBeenCalled();
    expect(await results(id)).toHaveLength(0);
    expect((await monitorRow(id)).status).toBe('up');

    await newSweep().sweep();
    expect(sent).toHaveLength(1);
  });

  it('late with the warning off sends nothing and still closes the episode', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 65, warnings: false });
    await newSweep().sweep();
    expect(sent).toEqual([]);
    expect((await monitorRow(id)).heartbeatState?.lateEpisodeKey).toMatch(
      /^heartbeat_late:/,
    );
  });

  it('two workers never evaluate the same monitor twice', async () => {
    const ids = await Promise.all([1, 2, 3].map(() => seedHeartbeat()));
    for (const id of ids) await ping(id);

    const [a, b] = await Promise.all([
      newSweep().claim(true),
      newSweep().claim(true),
    ]);
    const claimedA = a.rows.map((m) => m.id);
    const claimedB = b.rows.map((m) => m.id);
    expect([...claimedA, ...claimedB].sort()).toEqual([...ids].sort());
    expect(claimedA.filter((id) => claimedB.includes(id))).toEqual([]);

    // Full sweeps racing: one result row per ping.
    const [id] = ids;
    await client`UPDATE monitors SET heartbeat_state = heartbeat_state - 'leaseUntil'`;
    await Promise.all([newSweep().sweep(), newSweep().sweep()]);
    expect(await results(id)).toHaveLength(1);
  });

  it('a ping during evaluation is not blocked and is picked up by the next sweep', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    sendDelayMs = 1500;
    const sending = new Promise<void>((resolve) => (onSend = resolve));
    const sweep = newSweep().sweep();
    await sending;

    const [{ name }] = await client`SELECT current_database() AS name`;
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const other = postgres(target.toString(), { max: 1, onnotice: () => {} });
    try {
      await other`SET lock_timeout = '2s'`;
      const started = Date.now();
      await ping(id, 'ping', other);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      await other.end({ timeout: 5 });
    }
    await sweep;

    let monitor = await monitorRow(id);
    expect(monitor.status).toBe('down');
    expect(monitor.heartbeatState).toMatchObject({
      pingSeq: 2,
      evaluatedSeq: 1,
    });

    sendDelayMs = 0;
    await newSweep().sweep();
    monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState?.evaluatedSeq).toBe(2);
  });

  it('retakes an expired lease and leaves a live one alone', async () => {
    const live = await seedHeartbeat();
    const expired = await seedHeartbeat();
    await ping(live);
    await ping(expired);
    await setState(live, {
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    await setState(expired, {
      leaseUntil: new Date(Date.now() - 1_000).toISOString(),
    });

    const { rows } = await newSweep().claim(true);
    expect(rows.map((m) => m.id)).toEqual([expired]);
  });

  it('skips paused, disabled, deleting and pending-deletion monitors', async () => {
    const paused = await seedHeartbeat({ pingAgoMin: 80, status: 'paused' });
    const disabled = await seedHeartbeat({ pingAgoMin: 80, enabled: false });
    const deleting = await seedHeartbeat({ pingAgoMin: 80 });
    await db
      .update(schema.monitors)
      .set({ deletingAt: new Date() })
      .where(eq(schema.monitors.id, deleting));
    for (const id of [paused, disabled, deleting])
      await setState(id, { pingSeq: 2 });
    expect((await newSweep().claim(true)).rows).toEqual([]);

    const pendingOrg = await seedHeartbeat({ pingAgoMin: 80 });
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, organizationId));
    expect((await newSweep().claim(true)).rows).toEqual([]);
    expect(await results(pendingOrg)).toHaveLength(0);
  });

  it('records nothing for a monitor paused between claim and evaluation', async () => {
    const id = await seedHeartbeat();
    await ping(id);
    const sweep = newSweep();
    const { rows } = await sweep.claim(true);
    await db
      .update(schema.monitors)
      .set({ status: 'paused' })
      .where(eq(schema.monitors.id, id));
    const monitorService = (
      sweep as unknown as { monitorService: MonitorService }
    ).monitorService;
    await monitorService.recordExternalResult(rows[0], {
      monitorId: id,
      location: 'local',
      status: 'up',
      isUp: true,
      checkedAt: new Date(),
    });
    expect(await results(id)).toHaveLength(0);
    expect((await monitorRow(id)).status).toBe('paused');
  });

  it('alerts the first missed run of a heartbeat put back to pending (resume or restore)', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80, status: 'pending' });
    await newSweep().sweep();
    expect((await results(id))[0]).toMatchObject({ isUp: false });
    expect((await monitorRow(id)).status).toBe('down');
    expect(sent).toContain(`monitor_failure:${customProvider}`);
  });

  it('alerts a /fail that is the first signal of a pending heartbeat', async () => {
    const id = await seedHeartbeat();
    await ping(id, 'fail');
    await newSweep().sweep();
    expect((await monitorRow(id)).status).toBe('down');
    expect(sent).toContain(`monitor_failure:${customProvider}`);
  });

  it('a worker whose lease expired mid-batch and was retaken records nothing', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    const stale = newSweep();
    const realClaim = stale.claim.bind(stale);
    const retaken = new Date(Date.now() + 120_000).toISOString();
    jest.spyOn(stale, 'claim').mockImplementationOnce(async (detect) => {
      const claimed = await realClaim(detect);
      // Another worker took the row over after this lease ran out.
      await setState(id, { leaseUntil: retaken });
      return claimed;
    });
    await stale.sweep();
    expect(await results(id)).toHaveLength(0);
    expect(sent).toEqual([]);
    expect((await monitorRow(id)).heartbeatState?.leaseUntil).toBe(retaken);
  });

  it('drops a miss when a ping lands between claim and evaluation', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    const sweep = newSweep();
    const realClaim = sweep.claim.bind(sweep);
    jest.spyOn(sweep, 'claim').mockImplementationOnce(async (detect) => {
      const claimed = await realClaim(detect);
      await ping(id);
      return claimed;
    });
    await sweep.sweep();
    expect(await results(id)).toHaveLength(0);
    const monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState?.leaseUntil).toBeUndefined();
    await newSweep().sweep();
    expect((await results(id))[0]).toMatchObject({ isUp: true });
  });

  it('skips a usage-blocked monitor and keeps its lease so it is retried later', async () => {
    const id = await seedHeartbeat({ pingAgoMin: 80 });
    usage.shouldBlockExecution.mockResolvedValue({
      blocked: true,
      reason: 'plan',
    });
    await newSweep().sweep();

    expect(await results(id)).toHaveLength(0);
    expect(sent).toEqual([]);
    const monitor = await monitorRow(id);
    expect(monitor.status).toBe('up');
    expect(monitor.heartbeatState?.leaseUntil).toBeDefined();
  });

  it('claims only new pings while the ingest stamp is missing', async () => {
    const overdue = await seedHeartbeat({ pingAgoMin: 80 });
    const pinged = await seedHeartbeat();
    await ping(pinged);
    const { rows } = await newSweep().claim(false);
    expect(rows.map((m) => m.id)).toEqual([pinged]);
    expect(await results(overdue)).toHaveLength(0);
  });
});
