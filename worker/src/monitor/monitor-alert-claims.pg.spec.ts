/**
 * Real-PostgreSQL tests for durable monitor alert claims. Skipped unless MONITOR_CYCLE_TEST_DATABASE_URL is
 * set (CI sets it): the races between evaluators cannot be shown with a mock. Migrations are applied by the
 * app's own runner into a throwaway database, so the partial unique index is the real one.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import type { DbService } from '../db/db.service';
import {
  createTestDatabase,
  seedMonitor,
} from '../monitor-control/pg-test-database';
import {
  MAX_CLAIM_ATTEMPTS,
  MonitorAlertService,
} from './services/monitor-alert.service';
import {
  MonitorEvaluator,
  type AggregatedAlertState,
} from './monitor-evaluator';
import type { MonitorExecutionResult } from './types/monitor-result.type';

jest.mock('../common/notification-provider-crypto', () => ({
  decryptNotificationProviderConfig: jest.fn((config) => config),
}));
jest.setTimeout(120_000);

const url = process.env.MONITOR_CYCLE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('monitor alert claims (PostgreSQL)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let monitorId: string;
  let organizationId: string;
  let projectId: string;
  let providerIds: string[];
  let outageKey: string;

  // Fake channel layer: which providers fail, and how long a send takes (so evaluators overlap).
  const failing = new Set<string>();
  let sendDelayMs = 0;
  const sent: string[] = [];
  const notificationService = {
    sendNotificationToMultipleProviders: jest.fn(
      async (
        providers: Array<{ id: string }>,
        payload: { type: string; message: string },
      ) => {
        if (sendDelayMs) await new Promise((r) => setTimeout(r, sendDelayMs));
        const results = providers.map((provider) => {
          const success = !failing.has(provider.id);
          if (success) sent.push(`${payload.type}:${provider.id}`);
          return {
            provider,
            success,
            error: success ? undefined : 'channel down',
          };
        });
        const ok = results.filter((r) => r.success).length;
        return { success: ok, failed: results.length - ok, results };
      },
    ),
  };
  const triage = {
    enqueueAlertHistoryRows: jest.fn().mockResolvedValue(undefined),
    enqueueSourceRecovery: jest.fn().mockResolvedValue(true),
    enqueueSourceFailure: jest.fn().mockResolvedValue(true),
  };
  const configService = { get: jest.fn(() => 'https://app.example.com') };

  /** Each call is a separate worker process: its own service and evaluator, the same database. */
  const newEvaluator = () => {
    const dbService = { db } as unknown as DbService;
    const alerts = new MonitorAlertService(
      dbService,
      configService as never,
      notificationService as never,
      triage as never,
    );
    return new MonitorEvaluator(dbService, alerts);
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
    failing.clear();
    sent.length = 0;
    sendDelayMs = 0;
    ({ monitorId, organizationId } = await seedMonitor(db, client));
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    projectId = project.id;
    const providers = await db
      .insert(schema.notificationProviders)
      .values(
        ['a', 'b'].map((name) => ({
          organizationId,
          projectId,
          name,
          type: 'webhook' as const,
          config: { url: `https://hooks.example.com/${name}` } as never,
        })),
      )
      .returning();
    providerIds = providers.map((p) => p.id).sort();
    await db.insert(schema.monitorNotificationSettings).values(
      providerIds.map((notificationProviderId) => ({
        monitorId,
        notificationProviderId,
      })),
    );
    outageKey = randomUUID();
    await db
      .update(schema.monitors)
      .set({
        status: 'down',
        config: {
          locationConfig: { enabled: true, locations: ['a', 'b'] },
        } as never,
      })
      .where(eq(schema.monitors.id, monitorId));
  });

  const rows = (type?: string) =>
    db
      .select()
      .from(schema.alertHistory)
      .where(
        and(
          eq(schema.alertHistory.monitorId, monitorId),
          type ? eq(schema.alertHistory.type, type as never) : undefined,
        ),
      )
      .orderBy(schema.alertHistory.alertOrdinal, schema.alertHistory.provider);

  const state = (
    over: Partial<AggregatedAlertState> = {},
  ): AggregatedAlertState => ({
    consecutiveFailureCount: 1,
    consecutiveSuccessCount: 0,
    alertsSentForFailure: 0,
    alertsSentForRecovery: 0,
    executionGroupId: 'group-1',
    outageKey,
    ...over,
  });

  /** The cycle closer commits the state with the monitor row; the persist guards read it back. */
  async function commitState(s: AggregatedAlertState) {
    await db
      .update(schema.monitors)
      .set({
        config: {
          locationConfig: { enabled: true, locations: ['a', 'b'] },
          aggregatedAlertState: s,
        } as never,
      })
      .where(eq(schema.monitors.id, monitorId));
  }

  async function evaluate(
    evaluator: MonitorEvaluator,
    s: AggregatedAlertState,
    currentStatus: 'up' | 'down' = 'down',
  ) {
    const [monitor] = await db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, monitorId));
    return evaluator.evaluateAndSendAlert({
      monitorId,
      monitor,
      previousStatus: 'down',
      currentStatus,
      reason: 'down in 2/2 locations',
      metadata: { locationResults: [{}, {}] },
      preparedAlertState: s,
      observedAt: new Date('2026-10-21T10:00:00Z'),
    });
  }

  const storedState = async () => {
    const [m] = await db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, monitorId));
    return (m.config as { aggregatedAlertState?: AggregatedAlertState })
      .aggregatedAlertState;
  };

  it('two evaluators due for the same alert send it once per provider', async () => {
    sendDelayMs = 100; // both are mid-send at the same time
    const s = state();
    await commitState(s);
    const [x, y] = await Promise.all([
      evaluate(newEvaluator(), s),
      evaluate(newEvaluator(), s),
    ]);
    expect(sent.sort()).toEqual(
      providerIds.map((id) => `monitor_failure:${id}`).sort(),
    );
    expect([x.alertSent, y.alertSent].sort()).toEqual([false, true]);
    const history = await rows('monitor_failure');
    expect(history.map((r) => [r.status, r.alertOrdinal, r.outageKey])).toEqual(
      [
        ['sent', 0, outageKey],
        ['sent', 0, outageKey],
      ],
    );
    // Only sent/failed rows reach incident triage, once each.
    expect(
      triage.enqueueAlertHistoryRows.mock.calls.flatMap(([r]) => r),
    ).toHaveLength(2);
  });

  it('retries only the provider that failed, and gives up after the attempt cap', async () => {
    const s = state();
    await commitState(s);
    const [good, bad] = providerIds;
    failing.add(bad);

    const first = await evaluate(newEvaluator(), s);
    expect(first).toEqual({ alertSent: false, deliveryFailed: true });
    expect((await rows()).map((r) => [r.provider, r.status])).toEqual([
      [good, 'sent'],
      [bad, 'failed'],
    ]);
    expect(await storedState()).toMatchObject({ alertsSentForFailure: 0 });

    // The next check retries the failed channel alone; the delivered one is not messaged again.
    sent.length = 0;
    failing.delete(bad);
    const second = await evaluate(newEvaluator(), s);
    expect(second).toEqual({ alertSent: true, alertType: 'failure' });
    expect(sent).toEqual([`monitor_failure:${bad}`]);
    const after = await rows();
    expect(after.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(after.find((r) => r.provider === bad)?.claimAttempts).toBe(2);
    expect(await storedState()).toMatchObject({ alertsSentForFailure: 1 });
  });

  it('stops retrying a provider after MAX_CLAIM_ATTEMPTS and counts the alert delivered', async () => {
    const s = state();
    await commitState(s);
    const [good, bad] = providerIds;
    failing.add(bad);
    const outcomes: unknown[] = [];
    for (let i = 0; i < MAX_CLAIM_ATTEMPTS + 2; i++) {
      outcomes.push(await evaluate(newEvaluator(), s));
    }
    expect(sent.filter((entry) => entry.endsWith(good)).length).toBe(1);
    expect(
      notificationService.sendNotificationToMultipleProviders.mock.calls.filter(
        ([providers]) => providers.some((p: { id: string }) => p.id === bad),
      ),
    ).toHaveLength(MAX_CLAIM_ATTEMPTS);
    // Attempts 1..cap-1 leave the alert owed; the last one gives up on the failing channel.
    expect(outcomes.slice(0, MAX_CLAIM_ATTEMPTS - 1)).toEqual(
      Array(MAX_CLAIM_ATTEMPTS - 1).fill({
        alertSent: false,
        deliveryFailed: true,
      }),
    );
    expect(outcomes[MAX_CLAIM_ATTEMPTS - 1]).toEqual({
      alertSent: true,
      alertType: 'failure',
    });
    expect((await rows()).map((r) => r.status)).toEqual(['sent', 'failed']);
  });

  it('after a crash, a fresh pending claim is left alone and a stale one is taken over', async () => {
    const s = state();
    await commitState(s);
    const claimRow = (provider: string, ageSeconds: number) =>
      client`INSERT INTO alert_history (id, type, message, target, target_type, monitor_id, provider, status, sent_at, outage_key, alert_ordinal, claim_attempts)
        VALUES (uuidv7(), 'monitor_failure', 'm', 'API', 'monitor', ${monitorId}, ${provider}, 'pending', now() - make_interval(secs => ${ageSeconds}), ${outageKey}, 0, 1)`;
    await claimRow(providerIds[0], 5); // another evaluator is sending right now
    await claimRow(providerIds[1], 600); // its process died after claiming

    const result = await evaluate(newEvaluator(), s);
    // The dead claim is re-sent; the live one is not, and the alert stays open until its holder finishes.
    expect(sent).toEqual([`monitor_failure:${providerIds[1]}`]);
    expect(result).toEqual({ alertSent: false });
    const history = await rows();
    expect(history.map((r) => [r.status, r.claimAttempts])).toEqual([
      ['pending', 1],
      ['sent', 2],
    ]);
    expect(await storedState()).toMatchObject({ alertsSentForFailure: 0 });
  });

  it('a lost counter write cannot resend: the next check finds the claim, sends nothing and catches the counter up', async () => {
    const s = state();
    await commitState(s);
    expect(await evaluate(newEvaluator(), s)).toMatchObject({
      alertSent: true,
    });
    expect(sent).toHaveLength(2);
    // The counter write after the first delivery is lost.
    await commitState(s);
    sent.length = 0;

    const again = await evaluate(
      newEvaluator(),
      state({ consecutiveFailureCount: 2 }),
    );
    expect(again).toEqual({ alertSent: false });
    expect(sent).toEqual([]);
    expect(await storedState()).toMatchObject({
      alertsSentForFailure: 1,
      lastAlertCount: 2,
    });
  });

  it('uses one claim per reminder window, and a new outage claims afresh', async () => {
    const s = state();
    await commitState(s);
    await evaluate(newEvaluator(), s);
    // N = 5, threshold 1: the first reminder window opens 5 failures after the threshold.
    const reminder = state({
      consecutiveFailureCount: 6,
      alertsSentForFailure: 1,
      lastAlertCount: 1,
      lastAlertWindows: 1,
      alertCounterVersion: 2,
    });
    await commitState(reminder);
    expect(await evaluate(newEvaluator(), reminder)).toMatchObject({
      alertSent: true,
    });
    expect((await rows()).map((r) => r.alertOrdinal)).toEqual([0, 0, 1, 1]);

    const next = state({ outageKey: randomUUID() });
    await commitState(next);
    await evaluate(newEvaluator(), next);
    expect((await rows()).filter((r) => r.alertOrdinal === 0)).toHaveLength(4);
  });

  it('claims the recovery once per outage, under the failure outage key', async () => {
    sendDelayMs = 50;
    const recovered = state({
      consecutiveFailureCount: 0,
      consecutiveSuccessCount: 1,
      recoverySequence: true,
    });
    await commitState(recovered);
    await Promise.all([
      evaluate(newEvaluator(), recovered, 'up'),
      evaluate(newEvaluator(), recovered, 'up'),
    ]);
    await evaluate(newEvaluator(), recovered, 'up'); // a retried cycle
    expect(sent.sort()).toEqual(
      providerIds.map((id) => `monitor_recovery:${id}`).sort(),
    );
    const history = await rows('monitor_recovery');
    expect(history.map((r) => [r.alertOrdinal, r.outageKey])).toEqual([
      [0, outageKey],
      [0, outageKey],
    ]);
  });

  it('single location: the result row carries the outage key, and a newer row with a stale counter does not resend', async () => {
    await db
      .update(schema.monitors)
      .set({ config: {} })
      .where(eq(schema.monitors.id, monitorId));
    const result = (n: number, alertsSent = 0) =>
      db.insert(schema.monitorResults).values({
        monitorId,
        location: 'us-east',
        checkedAt: new Date(Date.UTC(2026, 9, 21, 10, n)),
        status: 'down',
        isUp: false,
        details: { outageKey },
        consecutiveFailureCount: n,
        alertsSentForFailure: alertsSent,
      } as never);
    const single = async () => {
      const [monitor] = await db
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId));
      return newEvaluator().evaluateAndSendAlert({
        monitorId,
        monitor,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: {},
      });
    };
    await result(1);
    sendDelayMs = 50;
    await Promise.all([single(), single()]);
    expect(sent).toHaveLength(2);

    // Check 2 lands carrying the counter as it was before check 1's update: same window, no resend.
    await result(2, 0);
    sent.length = 0;
    expect(await single()).toEqual({ alertSent: false });
    expect(sent).toEqual([]);
  });

  it('without an outage key on the result (older workers) the alert is sent unclaimed, as before claims', async () => {
    await db
      .update(schema.monitors)
      .set({ config: {} })
      .where(eq(schema.monitors.id, monitorId));
    await db.insert(schema.monitorResults).values({
      monitorId,
      location: 'us-east',
      checkedAt: new Date(),
      status: 'down',
      isUp: false,
      details: {},
      consecutiveFailureCount: 1,
    } as never);
    const [monitor] = await db
      .select()
      .from(schema.monitors)
      .where(eq(schema.monitors.id, monitorId));
    const run = () =>
      newEvaluator().evaluateAndSendAlert({
        monitorId,
        monitor,
        previousStatus: 'down',
        currentStatus: 'down',
        reason: 'down',
        metadata: {},
      });
    await run();
    const history = await rows('monitor_failure');
    expect(history).toHaveLength(2);
    expect(history.every((r) => r.outageKey === null)).toBe(true);
  });

  describe('SSL certificate renewed notice', () => {
    const cert = (days: number, validTo: string, valid = true) =>
      ({
        valid,
        daysRemaining: days,
        validTo,
        issuer: 'CA',
      }) as never;
    const reading = (
      certificate: ReturnType<typeof cert>,
    ): MonitorExecutionResult =>
      ({
        monitorId,
        location: 'us-east',
        status: 'up',
        isUp: true,
        responseTimeMs: 10,
        checkedAt: new Date(),
        details: { sslCertificate: certificate },
      }) as never;

    beforeEach(async () => {
      await db
        .update(schema.monitors)
        .set({
          status: 'up',
          target: 'https://example.com',
          config: { enableSslCheck: true },
          alertConfig: {
            enabled: true,
            alertOnFailure: true,
            alertOnRecovery: true,
            alertOnSslExpiration: true,
            failureThreshold: 1,
            recoveryThreshold: 1,
          } as never,
        })
        .where(eq(schema.monitors.id, monitorId));
    });

    const check = async (
      evaluator: MonitorEvaluator,
      r: MonitorExecutionResult,
    ) => {
      const [monitor] = await db
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId));
      await evaluator.checkSslExpirationAlert(r, monitor);
    };

    it('warns, remembers the warning, then sends one renewed notice per provider when two regions read the new certificate', async () => {
      const ev = newEvaluator();
      await check(ev, reading(cert(5, '2026-12-01T00:00:00.000Z')));
      expect(sent).toHaveLength(2);
      expect(sent.every((s) => s.startsWith('ssl_expiring:'))).toBe(true);
      const [stored] = await db
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId));
      expect(
        (stored.config as { sslAlertState?: { host: string } }).sslAlertState,
      ).toMatchObject({
        host: 'example.com',
        validTo: '2026-12-01T00:00:00.000Z',
      });

      sent.length = 0;
      sendDelayMs = 50;
      const renewed = reading(cert(89, '2027-02-01T00:00:00.000Z'));
      await Promise.all([
        check(newEvaluator(), renewed),
        check(newEvaluator(), renewed),
      ]);
      expect(sent.sort()).toEqual(
        providerIds.map((id) => `ssl_renewed:${id}`).sort(),
      );
      const history = await rows('ssl_renewed');
      expect(history).toHaveLength(2);
      expect(history.every((r) => r.status === 'sent')).toBe(true);
      expect(history[0].message).toContain('valid until 2027-02-01');
      // Informational: never queued for incident triage.
      const queued = triage.enqueueAlertHistoryRows.mock.calls.flatMap(
        ([r]) => r as Array<{ id: string }>,
      );
      expect(queued.map((r) => r.id)).not.toEqual(
        expect.arrayContaining(history.map((r) => r.id)),
      );
      const [after] = await db
        .select()
        .from(schema.monitors)
        .where(eq(schema.monitors.id, monitorId));
      expect(
        (after.config as { sslAlertState?: unknown }).sslAlertState,
      ).toBeUndefined();

      // Once per renewal: a later healthy read says nothing.
      sent.length = 0;
      await check(newEvaluator(), renewed);
      expect(sent).toEqual([]);
    });

    it('sends no renewed notice when no warning was sent', async () => {
      await check(
        newEvaluator(),
        reading(cert(89, '2027-02-01T00:00:00.000Z')),
      );
      expect(sent).toEqual([]);
    });

    it('a new expiry later than the warned one counts as renewed even inside the warning window', async () => {
      await check(newEvaluator(), reading(cert(2, '2026-11-11T00:00:00.000Z')));
      sent.length = 0;
      await check(
        newEvaluator(),
        reading(cert(20, '2026-11-29T00:00:00.000Z')),
      );
      expect(sent.every((s) => s.startsWith('ssl_renewed:'))).toBe(true);
      expect(sent).toHaveLength(2);
    });

    it('is held back during scheduled maintenance and sent after it', async () => {
      await check(newEvaluator(), reading(cert(5, '2026-12-01T00:00:00.000Z')));
      sent.length = 0;
      const [component] = await db
        .insert(schema.statusPageComponents)
        .values({ name: 'c', statusPageId: await statusPage() } as never)
        .returning();
      await db
        .insert(schema.statusPageComponentMonitors)
        .values({ componentId: component.id, monitorId } as never);
      const [incident] = await db
        .insert(schema.incidents)
        .values({
          statusPageId: await statusPage(),
          name: 'maint',
          status: 'scheduled',
          impact: 'none',
          scheduledFor: new Date(Date.now() - 60_000),
          scheduledUntil: new Date(Date.now() + 3_600_000),
        } as never)
        .returning();
      await db.insert(schema.incidentComponents).values({
        incidentId: incident.id,
        componentId: component.id,
      } as never);

      const healthy = reading(cert(89, '2027-02-01T00:00:00.000Z'));
      await check(newEvaluator(), healthy);
      expect(sent).toEqual([]);

      await db
        .update(schema.incidents)
        .set({ status: 'resolved' })
        .where(eq(schema.incidents.id, incident.id));
      await check(newEvaluator(), healthy);
      expect(sent).toHaveLength(2);
    });

    async function statusPage() {
      const existing = await db.select().from(schema.statusPages).limit(1);
      if (existing[0]) return existing[0].id;
      const [page] = await db
        .insert(schema.statusPages)
        .values({
          organizationId,
          projectId,
          name: 'Status',
          subdomain: `s${randomUUID().slice(0, 8)}`,
        } as never)
        .returning();
      return page.id;
    }
  });
});
