/** @jest-environment node */
import {
  endExpiredTrials,
  reconcilePaidTrialSuspensions,
  restoreTrialSuspensions,
  sendTrialReminders,
} from "./trial-lifecycle";

jest.mock("@/utils/db", () => ({ db: {} }));
const deleteScheduledMonitor = jest.fn().mockResolvedValue(true);
const scheduleMonitor = jest.fn().mockResolvedValue("sched-new");
jest.mock("@/lib/monitor-scheduler", () => ({
  deleteScheduledMonitor: (...args: unknown[]) => deleteScheduledMonitor(...args),
  scheduleMonitor: (...args: unknown[]) => scheduleMonitor(...args),
}));
beforeEach(() => {
  deleteScheduledMonitor.mockClear();
  scheduleMonitor.mockClear();
});

/** Awaitable stand-in for a drizzle query builder that resolves to `result`. */
function chain<T>(result: T) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "from",
    "innerJoin",
    "where",
    "orderBy",
    "for",
    "limit",
    "set",
    "values",
    "onConflictDoNothing",
    "returning",
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (
    resolve: (value: T) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const NOW = new Date("2026-11-06T00:00:00Z");
const PAST = new Date("2026-11-05T00:00:00Z");
const trialOrg = {
  id: "org",
  polarCustomerId: null,
  subscriptionPlan: null,
  subscriptionStatus: "none",
  subscriptionEndsAt: null,
};

interface Fixture {
  expired?: Array<{ organizationId: string }>;
  org?: Record<string, unknown> | undefined;
  running?: Array<{ id: string; status: string; scheduledJobId?: string | null }>;
  published?: Array<{ id: string }>;
}

function build(fixture: Fixture) {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const inserts: unknown[] = [];
  let calls = 0;
  const tx = {
    select: jest.fn().mockImplementation(() => {
      const step = calls++ % 3;
      return chain(
        step === 0
          ? fixture.org
            ? [fixture.org]
            : []
          : step === 1
            ? (fixture.running ?? [])
            : (fixture.published ?? []),
      );
    }),
    insert: jest.fn(() => ({
      values: jest.fn((rows: unknown) => {
        inserts.push(rows);
        return chain(undefined);
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return chain([]);
      }),
    })),
  };
  const database = {
    select: jest.fn(() =>
      chain(fixture.expired ?? [{ organizationId: "org" }]),
    ),
    update: jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => {
        updates.push({ table: "monitors", values });
        return chain([]);
      }),
    })),
    transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  return { database: database as never, tx, updates, inserts };
}

describe("endExpiredTrials", () => {
  it("does nothing when no trial has expired", async () => {
    const { database, tx } = build({ expired: [] });
    await expect(endExpiredTrials({ now: NOW, database })).resolves.toEqual({
      organizations: 0,
      monitorsPaused: 0,
      statusPagesArchived: 0,
    });
    expect(tx.select).not.toHaveBeenCalled();
  });

  it("pauses running monitors, archives published pages and records what it changed", async () => {
    const { database, updates, inserts } = build({
      org: trialOrg,
      running: [
        { id: "m1", status: "up" },
        { id: "m2", status: "down" },
      ],
      published: [{ id: "p1" }],
    });
    await expect(endExpiredTrials({ now: NOW, database })).resolves.toEqual({
      organizations: 1,
      monitorsPaused: 2,
      statusPagesArchived: 1,
    });
    expect(inserts[0]).toEqual([
      {
        organizationId: "org",
        resourceType: "monitor",
        resourceId: "m1",
        previousStatus: "up",
      },
      {
        organizationId: "org",
        resourceType: "monitor",
        resourceId: "m2",
        previousStatus: "down",
      },
      {
        organizationId: "org",
        resourceType: "status_page",
        resourceId: "p1",
        previousStatus: "published",
      },
    ]);
    expect(updates.map((update) => update.values)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "paused" }),
        expect.objectContaining({ status: "archived" }),
        expect.objectContaining({ lifecycleEndedAt: NOW }),
      ]),
    );
  });

  it("removes the repeatable schedule of each paused monitor and clears its scheduledJobId", async () => {
    const { database, updates } = build({
      org: trialOrg,
      running: [
        { id: "m1", status: "up", scheduledJobId: "sched-1" },
        { id: "m2", status: "down", scheduledJobId: null },
      ],
    });
    await endExpiredTrials({ now: NOW, database });
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("sched-1");
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("m1");
    expect(deleteScheduledMonitor).toHaveBeenCalledWith("m2");
    expect(updates.filter((u) => u.table === "monitors" && u.values.scheduledJobId === null)).toHaveLength(2);
  });

  it("does not touch schedules when the organization pays", async () => {
    const { database } = build({
      org: { ...trialOrg, polarCustomerId: "cus", subscriptionPlan: "plus", subscriptionStatus: "active" },
      running: [{ id: "m1", status: "up", scheduledJobId: "sched-1" }],
    });
    await endExpiredTrials({ now: NOW, database });
    expect(deleteScheduledMonitor).not.toHaveBeenCalled();
  });

  it("keeps draining batches while they come back full, instead of waiting for the next run", async () => {
    const { database } = build({ org: trialOrg, running: [] });
    const select = (database as unknown as { select: jest.Mock }).select;
    select.mockReset();
    select
      .mockReturnValueOnce(chain(Array.from({ length: 50 }, (_, i) => ({ organizationId: `org-${i}` }))))
      .mockReturnValueOnce(chain([{ organizationId: "org-last" }]));
    const result = await endExpiredTrials({ now: NOW, database });
    expect(select).toHaveBeenCalledTimes(2);
    expect(result.organizations).toBe(51);
  });

  it("still marks a trial with nothing to suspend as ended", async () => {
    const { database, updates, inserts } = build({ org: trialOrg });
    await expect(
      endExpiredTrials({ now: NOW, database }),
    ).resolves.toMatchObject({
      organizations: 1,
      monitorsPaused: 0,
      statusPagesArchived: 0,
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ lifecycleEndedAt: NOW });
  });

  it.each([
    [
      "an active subscription",
      {
        ...trialOrg,
        polarCustomerId: "cus",
        subscriptionPlan: "plus",
        subscriptionStatus: "active",
      },
    ],
    [
      "a past-due subscription",
      {
        ...trialOrg,
        polarCustomerId: "cus",
        subscriptionPlan: "pro",
        subscriptionStatus: "past_due",
      },
    ],
    [
      "a canceled subscription still in its paid period",
      {
        ...trialOrg,
        polarCustomerId: "cus",
        subscriptionPlan: "plus",
        subscriptionStatus: "canceled",
        subscriptionEndsAt: new Date(NOW.getTime() + 86_400_000),
      },
    ],
  ])("leaves a paying organization untouched (%s)", async (_label, org) => {
    const { database, updates, tx } = build({
      org,
      running: [{ id: "m1", status: "up" }],
    });
    await expect(
      endExpiredTrials({ now: NOW, database }),
    ).resolves.toMatchObject({ organizations: 0, monitorsPaused: 0 });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      expect.objectContaining({ values: { lifecycleEndedAt: NOW } }),
    ]);
  });

  it("suspends an organization whose canceled subscription has already ended", async () => {
    const lapsed = {
      ...trialOrg,
      polarCustomerId: "cus",
      subscriptionPlan: "plus",
      subscriptionStatus: "canceled",
      subscriptionEndsAt: PAST,
    };
    const { database } = build({
      org: lapsed,
      running: [{ id: "m1", status: "up" }],
    });
    await expect(
      endExpiredTrials({ now: NOW, database }),
    ).resolves.toMatchObject({ organizations: 1, monitorsPaused: 1 });
  });

  it("ends the trial of a deleted organization without suspending anything", async () => {
    const { database, inserts } = build({ org: undefined });
    await expect(
      endExpiredTrials({ now: NOW, database }),
    ).resolves.toMatchObject({ organizations: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("keeps ending the other organizations when one fails", async () => {
    const { database } = build({
      expired: [{ organizationId: "a" }, { organizationId: "b" }],
      org: trialOrg,
    });
    const transaction = (database as unknown as { transaction: jest.Mock }).transaction;
    const original = transaction.getMockImplementation()!;
    transaction.mockImplementationOnce(async () => {
      throw new Error("lock timeout");
    });
    transaction.mockImplementation(original);
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await endExpiredTrials({ now: NOW, database });
    spy.mockRestore();
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(result.organizations).toBe(1);
  });

  it("processes every expired organization in its own transaction", async () => {
    const { database } = build({
      expired: [{ organizationId: "a" }, { organizationId: "b" }],
      org: trialOrg,
    });
    await endExpiredTrials({ now: NOW, database });
    expect(
      (database as unknown as { transaction: jest.Mock }).transaction,
    ).toHaveBeenCalledTimes(2);
  });
});

describe("restoreTrialSuspensions", () => {
  function buildRestore(
    rows: Array<{ resourceType: string; resourceId: string }>,
    resumed = 0,
    restored = 0,
  ) {
    const sets: Array<Record<string, unknown>> = [];
    const results = [
      chain(Array(resumed).fill({ id: "x" })),
      chain(Array(restored).fill({ id: "y" })),
    ];
    const deletes: unknown[] = [];
    const tx = {
      select: jest.fn(() => chain(rows)),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          sets.push(values);
          return results.shift() ?? chain([]);
        }),
      })),
      delete: jest.fn(() => {
        deletes.push(true);
        return chain(undefined);
      }),
    };
    const monitorRows = rows
      .filter((row) => row.resourceType === "monitor")
      .map((row) => ({
        id: row.resourceId,
        frequencyMinutes: 5,
        projectId: "project",
        type: "http_request",
        target: "https://example.com",
        config: {},
      }));
    return {
      database: {
        transaction: async (callback: (tx: unknown) => unknown) => callback(tx),
        select: jest.fn(() => chain(monitorRows)),
        update: jest.fn(() => ({ set: jest.fn(() => chain([])) })),
      } as never,
      sets,
      deletes,
      tx,
    };
  }

  it("resumes paused monitors as pending, republishes archived pages and clears the records", async () => {
    const { database, sets, deletes } = buildRestore(
      [
        { resourceType: "monitor", resourceId: "m1" },
        { resourceType: "status_page", resourceId: "p1" },
      ],
      1,
      1,
    );
    await expect(restoreTrialSuspensions("org", database)).resolves.toEqual({
      monitorsResumed: 1,
      statusPagesRestored: 1,
    });
    expect(sets).toEqual([
      expect.objectContaining({ status: "pending" }),
      expect.objectContaining({ status: "published" }),
    ]);
    expect(deletes).toHaveLength(1);
  });

  it("schedules every resumed monitor again once the status change is written", async () => {
    const { database } = buildRestore([{ resourceType: "monitor", resourceId: "m1" }], 1, 0);
    await restoreTrialSuspensions("org", database);
    expect(scheduleMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ monitorId: "m1", frequencyMinutes: 5 }),
    );
  });

  it("does not fail the restore when a schedule cannot be created", async () => {
    scheduleMonitor.mockRejectedValueOnce(new Error("redis down"));
    const { database } = buildRestore([{ resourceType: "monitor", resourceId: "m1" }], 1, 0);
    await expect(restoreTrialSuspensions("org", database)).resolves.toMatchObject({ monitorsResumed: 1 });
  });

  it("does nothing for an organization with no suspended resources", async () => {
    const { database, tx } = buildRestore([]);
    await expect(restoreTrialSuspensions("org", database)).resolves.toEqual({
      monitorsResumed: 0,
      statusPagesRestored: 0,
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("restores only what is recorded", async () => {
    const { database, tx } = buildRestore(
      [{ resourceType: "monitor", resourceId: "m1" }],
      1,
      0,
    );
    await expect(restoreTrialSuspensions("org", database)).resolves.toEqual({
      monitorsResumed: 1,
      statusPagesRestored: 0,
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });
});

describe("reconcilePaidTrialSuspensions", () => {
  function buildReconcile(candidates: Array<Record<string, unknown>>) {
    const restoredRows = [{ resourceType: "monitor", resourceId: "m1" }];
    const tx = {
      select: jest.fn(() => chain(restoredRows)),
      update: jest.fn(() => ({ set: jest.fn(() => chain([{ id: "m1" }])) })),
      delete: jest.fn(() => chain(undefined)),
    };
    const database = {
      // The join already limits candidates to paying organizations that still have suspensions.
      selectDistinct: jest.fn(() => chain(candidates)),
      select: jest.fn(() => chain([{ id: "m1", frequencyMinutes: 5, type: "http_request", target: "x", config: {} }])),
      update: jest.fn(() => ({ set: jest.fn(() => chain([])) })),
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(tx)),
    };
    return database as never;
  }
  const paid = { id: "org", polarCustomerId: "cus", subscriptionPlan: "plus", subscriptionStatus: "active", subscriptionEndsAt: null };

  it("restores an organization that pays but is still suspended", async () => {
    await expect(reconcilePaidTrialSuspensions({ now: NOW, database: buildReconcile([paid]) })).resolves.toMatchObject({ organizations: 1, monitorsResumed: 1 });
    expect(scheduleMonitor).toHaveBeenCalled();
  });

  it("leaves unpaid organizations suspended", async () => {
    await expect(reconcilePaidTrialSuspensions({ now: NOW, database: buildReconcile([trialOrg]) })).resolves.toMatchObject({ organizations: 0 });
  });

  it("does nothing when nothing is suspended", async () => {
    await expect(reconcilePaidTrialSuspensions({ now: NOW, database: buildReconcile([]) })).resolves.toEqual({ organizations: 0, monitorsResumed: 0, statusPagesRestored: 0 });
  });
});

describe("sendTrialReminders", () => {
  const NOW_MS = NOW.getTime();
  const DAY = 86_400_000;
  const entry = (overrides: Record<string, unknown> = {}) => ({
    organizationId: "org",
    expiresAt: new Date(NOW_MS + 5 * DAY),
    name: "Acme",
    polarCustomerId: null,
    subscriptionPlan: null,
    subscriptionStatus: "none",
    subscriptionEndsAt: null,
    ...overrides,
  });

  /** One due list per reminder kind (midway, ending, ended), then owners per organization. */
  function build(
    due: { midway?: unknown[]; ending?: unknown[]; ended?: unknown[] },
    owners: Array<{ email: string; role?: string }> = [{ email: "owner@example.com" }],
  ) {
    const sets: Array<Record<string, unknown>> = [];
    const lists = [due.midway ?? [], due.ending ?? [], due.ended ?? []];
    let dueCall = 0;
    const database = {
      select: jest.fn((columns: Record<string, unknown>) =>
        "email" in columns ? chain(owners) : chain(lists[dueCall++] ?? []),
      ),
      update: jest.fn(() => ({
        set: jest.fn((values: Record<string, unknown>) => {
          sets.push(values);
          return chain(undefined);
        }),
      })),
    };
    return { database: database as never, sets };
  }

  it("emails the verified owners once and records it", async () => {
    const { database, sets } = build({ midway: [entry()] });
    const deliver = jest.fn().mockResolvedValue(true);
    await expect(
      sendTrialReminders({ now: NOW, database, deliver }),
    ).resolves.toEqual({ midway: 1, ending: 0, ended: 0 });
    expect(deliver).toHaveBeenCalledWith({
      kind: "midway",
      organizationId: "org",
      organizationName: "Acme",
      daysRemaining: 5,
      recipients: ["owner@example.com"],
    });
    expect(sets).toEqual([{ midwayNotifiedAt: NOW }]);
  });

  it("retries recording a delivered reminder so a transient write failure does not resend it", async () => {
    const { database, sets } = build({ midway: [entry()] });
    const update = (database as unknown as { update: jest.Mock }).update;
    const recorder = update.getMockImplementation()!;
    update.mockImplementationOnce(() => { throw new Error("db blip"); });
    update.mockImplementation(recorder);
    const deliver = jest.fn().mockResolvedValue(true);
    await expect(sendTrialReminders({ now: NOW, database, deliver })).resolves.toEqual({ midway: 1, ending: 0, ended: 0 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(sets).toEqual([{ midwayNotifiedAt: NOW }]);
  });

  it("keeps going when recording keeps failing after a successful send", async () => {
    const { database } = build({ midway: [entry({ organizationId: "a" }), entry({ organizationId: "b" })] });
    const update = (database as unknown as { update: jest.Mock }).update;
    update.mockImplementation(() => { throw new Error("db down"); });
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const deliver = jest.fn().mockResolvedValue(true);
    await expect(sendTrialReminders({ now: NOW, database, deliver })).resolves.toEqual({ midway: 2, ending: 0, ended: 0 });
    expect(update).toHaveBeenCalledTimes(6);
    error.mockRestore();
  });

  it("sends each kind from its own list and records the matching column", async () => {
    const { database, sets } = build({
      midway: [entry({ organizationId: "a" })],
      ending: [
        entry({ organizationId: "b", expiresAt: new Date(NOW_MS + 3_600_000) }),
      ],
      ended: [
        entry({ organizationId: "c", expiresAt: new Date(NOW_MS - DAY) }),
      ],
    });
    const deliver = jest.fn().mockResolvedValue(true);
    await expect(
      sendTrialReminders({ now: NOW, database, deliver }),
    ).resolves.toEqual({ midway: 1, ending: 1, ended: 1 });
    expect(
      deliver.mock.calls.map((call) => [call[0].kind, call[0].daysRemaining]),
    ).toEqual([
      ["midway", 5],
      ["ending", 1],
      ["ended", 0],
    ]);
    expect(sets).toEqual([
      { midwayNotifiedAt: NOW },
      { endingNotifiedAt: NOW },
      { endedNotifiedAt: NOW },
    ]);
  });

  it("keeps a reminder due when it could not be delivered, so the next run retries it", async () => {
    const { database, sets } = build({ midway: [entry()] });
    const deliver = jest.fn().mockResolvedValue(false);
    await expect(
      sendTrialReminders({ now: NOW, database, deliver }),
    ).resolves.toEqual({ midway: 0, ending: 0, ended: 0 });
    expect(sets).toHaveLength(0);
  });

  it.each([
    [
      "an active subscription",
      {
        polarCustomerId: "cus",
        subscriptionPlan: "plus",
        subscriptionStatus: "active",
      },
    ],
    [
      "a canceled subscription still in its paid period",
      {
        polarCustomerId: "cus",
        subscriptionPlan: "pro",
        subscriptionStatus: "canceled",
        subscriptionEndsAt: new Date(NOW_MS + DAY),
      },
    ],
  ])(
    "does not email an organization with %s, and stops considering it",
    async (_label, paid) => {
      const { database, sets } = build({ midway: [entry(paid)] });
      const deliver = jest.fn();
      await expect(
        sendTrialReminders({ now: NOW, database, deliver }),
      ).resolves.toEqual({ midway: 0, ending: 0, ended: 0 });
      expect(deliver).not.toHaveBeenCalled();
      expect(sets).toEqual([{ midwayNotifiedAt: NOW }]);
    },
  );

  it("emails an organization whose canceled subscription already ended", async () => {
    const { database } = build({
      ended: [
        entry({
          polarCustomerId: "cus",
          subscriptionPlan: "plus",
          subscriptionStatus: "canceled",
          subscriptionEndsAt: new Date(NOW_MS - DAY),
          expiresAt: new Date(NOW_MS - DAY),
        }),
      ],
    });
    const deliver = jest.fn().mockResolvedValue(true);
    await expect(
      sendTrialReminders({ now: NOW, database, deliver }),
    ).resolves.toMatchObject({ ended: 1 });
  });

  it("does not retry forever when an organization has no verified owner", async () => {
    const { database, sets } = build({ midway: [entry()] }, []);
    const deliver = jest.fn();
    await sendTrialReminders({ now: NOW, database, deliver });
    expect(deliver).not.toHaveBeenCalled();
    expect(sets).toEqual([{ midwayNotifiedAt: NOW }]);
  });

  it("falls back to verified organization admins when no owner has a verified address", async () => {
    const { database } = build({ midway: [entry()] }, [
      { email: "admin@example.com", role: "org_admin" },
    ]);
    const deliver = jest.fn().mockResolvedValue(true);
    await sendTrialReminders({ now: NOW, database, deliver });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ recipients: ["admin@example.com"] }));
  });

  it("prefers owners over admins when both are verified", async () => {
    const { database } = build({ midway: [entry()] }, [
      { email: "admin@example.com", role: "org_admin" },
      { email: "owner@example.com", role: "org_owner" },
    ]);
    const deliver = jest.fn().mockResolvedValue(true);
    await sendTrialReminders({ now: NOW, database, deliver });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ recipients: ["owner@example.com"] }));
  });

  it("sends to each distinct owner address once", async () => {
    const { database } = build({ midway: [entry()] }, [
      { email: "a@example.com" },
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);
    const deliver = jest.fn().mockResolvedValue(true);
    await sendTrialReminders({ now: NOW, database, deliver });
    expect(deliver.mock.calls[0][0].recipients).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("sends nothing when no trial is due", async () => {
    const { database } = build({});
    const deliver = jest.fn();
    await expect(
      sendTrialReminders({ now: NOW, database, deliver }),
    ).resolves.toEqual({ midway: 0, ending: 0, ended: 0 });
    expect(deliver).not.toHaveBeenCalled();
  });
});
