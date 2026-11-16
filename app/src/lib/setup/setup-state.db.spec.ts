/** @jest-environment node */
// CI-only: needs TEST_DATABASE_URL (run with `npm run test:db`).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { v7 as uuidv7 } from "uuid";

let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  countPlanMonitors: jest.fn(async () => 3),
  checkMonitorLimit: jest.fn(async () => ({ allowed: true, remaining: 2 })),
}));

import {
  claimAiRun,
  claimLock,
  getChecklistCounts,
  getSetupState,
  getUserPreferences,
  monitorsRemaining,
  releaseAiRun,
  releaseLock,
  saveSuggestions,
  setUserPersona,
  updateSetupState,
} from "./setup-state";
import { checkMonitorLimit } from "@/lib/middleware/plan-enforcement";

const APP_ROOT = path.resolve(__dirname, "../../..");
const databaseName = `setup_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;

const [orgA, orgB, projA, projB, projA2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const [u1, u2] = [uuidv7(), uuidv7()];

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${databaseName}`;
  await promisify(execFile)(process.execPath, [path.join(APP_ROOT, "scripts/db-migrate.js")], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90_000,
  });
  client = postgres(url.toString(), { max: 4, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });
  await client`INSERT INTO organization (id, name, slug, created_at) VALUES (${orgA}, 'a', ${orgA}, now()), (${orgB}, 'b', ${orgB}, now())`;
  await client`INSERT INTO projects (id, organization_id, name, slug) VALUES (${projA}, ${orgA}, 'pa', ${projA}), (${projB}, ${orgB}, 'pb', ${projB}), (${projA2}, ${orgA}, 'pa2', ${projA2})`;
  await client`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
    (${u1}, 'Una', 'u1@example.com', true, now(), now()), (${u2}, 'Dos', 'u2@example.com', true, now(), now())`;
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

afterEach(async () => {
  await client`DELETE FROM project_setup_state`;
  await client`DELETE FROM user_preferences`;
});

describe("getSetupState", () => {
  it("returns defaults when there is no row", async () => {
    expect(await getSetupState(orgA, projA, u1)).toEqual({
      status: "not_started", currentStep: null, draft: {}, skipped: [], statusPageOptOut: false, lock: null,
      lastAiRunAt: null, scanResult: null, completedAt: null, dismissedAt: null, updatedAt: null,
    });
  });
});

describe("updateSetupState", () => {
  it("inserts on first write, then needs the returned updatedAt", async () => {
    const first = await updateSetupState(orgA, projA, u1, { status: "in_progress", currentStep: "app", draft: { app: { url: "https://a.io/x?k=1" } } }, null);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.previousStatus).toBe("not_started");
    expect(first.state.draft).toEqual({ app: { url: "https://a.io/x" } });
    expect(first.state.updatedAt).not.toBeNull();

    const stale = await updateSetupState(orgA, projA, u1, { currentStep: "alerts" }, null);
    expect(stale.kind).toBe("conflict");
    const ok = await updateSetupState(orgA, projA, u1, { currentStep: "alerts" }, first.state.updatedAt);
    expect(ok.kind).toBe("ok");
    // The first token is now stale.
    expect((await updateSetupState(orgA, projA, u1, { currentStep: "tests" }, first.state.updatedAt)).kind).toBe("conflict");
  });

  it("two writers with the same token: exactly one wins", async () => {
    const first = await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null);
    if (first.kind !== "ok") throw new Error("setup");
    const results = await Promise.all([
      updateSetupState(orgA, projA, u1, { currentStep: "alerts" }, first.state.updatedAt),
      updateSetupState(orgA, projA, u1, { currentStep: "tests" }, first.state.updatedAt),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["conflict", "ok"]);
  });

  it("sets and clears completed_at / dismissed_at on status transitions", async () => {
    const done = await updateSetupState(orgA, projA, u1, { status: "completed" }, null);
    if (done.kind !== "ok") throw new Error("setup");
    expect(done.state.completedAt).not.toBeNull();
    const dismissed = await updateSetupState(orgA, projA, u1, { status: "dismissed" }, done.state.updatedAt);
    if (dismissed.kind !== "ok") throw new Error("setup");
    expect(dismissed.previousStatus).toBe("completed");
    expect(dismissed.state).toMatchObject({ completedAt: null });
    expect(dismissed.state.dismissedAt).not.toBeNull();
    const reopened = await updateSetupState(orgA, projA, u1, { status: "in_progress" }, dismissed.state.updatedAt);
    expect(reopened).toMatchObject({ kind: "ok", state: { dismissedAt: null, completedAt: null } });
  });

  it("rejects an invalid draft without writing", async () => {
    const result = await updateSetupState(orgA, projA, u1, { draft: { app: { password: "x" } } as never }, null);
    expect(result.kind).toBe("invalid");
    expect(await client`SELECT 1 FROM project_setup_state`).toHaveLength(0);
  });

  it("is refused while another user holds a live lock, allowed for the holder and after expiry", async () => {
    expect((await claimLock(orgA, projA, u1, null)).kind).toBe("ok");
    const refused = await updateSetupState(orgA, projA, u2, { currentStep: "app" }, null);
    expect(refused).toMatchObject({ kind: "locked", lock: { userId: u1, userName: "Una", mine: false } });
    // The lock-created row is "never written", so the holder's first write uses null.
    const mine = await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null);
    expect(mine.kind).toBe("ok");
    await client`UPDATE project_setup_state SET locked_at = now() - interval '16 minutes'`;
    const afterExpiry = await updateSetupState(orgA, projA, u2, { currentStep: "tests" }, mine.kind === "ok" ? mine.state.updatedAt : null);
    expect(afterExpiry.kind).toBe("ok");
  });

  it("tenant isolation: another org cannot write or read a project's row", async () => {
    const seeded = await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null);
    if (seeded.kind !== "ok") throw new Error("setup");
    const cross = await updateSetupState(orgB, projA, u2, { currentStep: "tests" }, null);
    expect(cross.kind).toBe("conflict");
    const crossWithToken = await updateSetupState(orgB, projA, u2, { currentStep: "tests" }, seeded.state.updatedAt);
    expect(crossWithToken.kind).toBe("conflict");
    const [row] = await client`SELECT current_step, organization_id FROM project_setup_state WHERE project_id = ${projA}`;
    expect(row).toMatchObject({ current_step: "app", organization_id: orgA });
    expect((await getSetupState(orgB, projA, u2)).currentStep).toBeNull();
    // A different project in the same org is independent.
    expect((await getSetupState(orgA, projA2, u1)).currentStep).toBeNull();
  });
});

describe("locks", () => {
  it("two concurrent claims: exactly one wins", async () => {
    const results = await Promise.all([claimLock(orgA, projA, u1, null), claimLock(orgA, projA, u2, null)]);
    expect(results.map((r) => r.kind).sort()).toEqual(["locked", "ok"]);
    const winner = results.find((r) => r.kind === "ok")!;
    const loser = results.find((r) => r.kind === "locked")!;
    expect(loser.lock.userId).toBe(winner.lock.userId);
    expect(loser.lock.mine).toBe(false);
  });

  it("heartbeat by the holder refreshes, a live lock blocks others, expiry frees it", async () => {
    await claimLock(orgA, projA, u1, null);
    await client`UPDATE project_setup_state SET locked_at = now() - interval '10 minutes'`;
    const beat = await claimLock(orgA, projA, u1, null);
    expect(beat.kind).toBe("ok");
    expect(Date.now() - new Date(beat.lock.lockedAt).getTime()).toBeLessThan(60_000);
    expect((await claimLock(orgA, projA, u2, null)).kind).toBe("locked");
    await client`UPDATE project_setup_state SET locked_at = now() - interval '16 minutes'`;
    expect((await getSetupState(orgA, projA, u2)).lock).toBeNull();
    expect((await claimLock(orgA, projA, u2, null)).kind).toBe("ok");
  });

  it("does not bump updated_at, so a heartbeat never invalidates the draft token", async () => {
    const first = await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null);
    if (first.kind !== "ok") throw new Error("setup");
    await claimLock(orgA, projA, u1, null);
    expect((await updateSetupState(orgA, projA, u1, { currentStep: "tests" }, first.state.updatedAt)).kind).toBe("ok");
  });

  it("release clears only the caller's own lock", async () => {
    await claimLock(orgA, projA, u1, null);
    await releaseLock(orgA, projA, u2, null);
    expect((await getSetupState(orgA, projA, u2)).lock?.userId).toBe(u1);
    await releaseLock(orgB, projA, u1, null); // wrong org
    expect((await getSetupState(orgA, projA, u2)).lock?.userId).toBe(u1);
    await releaseLock(orgA, projA, u1, null);
    expect((await getSetupState(orgA, projA, u2)).lock).toBeNull();
  });

  it("two tabs of the same user: only the holding tab may claim, write or release", async () => {
    const tabA = randomUUID();
    const tabB = randomUUID();
    expect((await claimLock(orgA, projA, u1, tabA)).kind).toBe("ok");
    const second = await claimLock(orgA, projA, u1, tabB);
    expect(second).toMatchObject({ kind: "locked", lock: { userId: u1, mine: false } });
    // Heartbeat by the holding tab still works; a GET with no tab identity reports the user's lock as mine.
    expect((await claimLock(orgA, projA, u1, tabA)).kind).toBe("ok");
    expect((await getSetupState(orgA, projA, u1)).lock?.mine).toBe(true);
    // A write from the other tab, or from one with no token, is refused; the holder's passes.
    expect(await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null, tabB)).toMatchObject({ kind: "locked" });
    expect(await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null, null)).toMatchObject({ kind: "locked" });
    expect((await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null, tabA)).kind).toBe("ok");
    // A fresh tab of the same user cannot reclaim while the holder's heartbeat is recent: 423 with sameUser.
    const refused = await claimLock(orgA, projA, u1, tabB, false, true);
    expect(refused).toMatchObject({ kind: "locked", lock: { userId: u1, sameUser: true, mine: false } });
    expect((await claimLock(orgA, projA, u1, tabA)).kind).toBe("ok");
    // 1 minute old: still protected. 3 minutes old (no heartbeat for over 2 minutes): reclaimed silently.
    await client`UPDATE project_setup_state SET locked_at = now() - interval '1 minute'`;
    expect((await claimLock(orgA, projA, u1, tabB, false, true)).kind).toBe("locked");
    await client`UPDATE project_setup_state SET locked_at = now() - interval '3 minutes'`;
    expect((await claimLock(orgA, projA, u1, tabB, false, true)).kind).toBe("ok");
    expect((await claimLock(orgA, projA, u1, tabA)).kind).toBe("locked");
    // An explicit force ("Use this tab instead") takes a live lock from the user's own tab.
    expect((await claimLock(orgA, projA, u1, tabA, false, true, true)).kind).toBe("ok");
    expect((await claimLock(orgA, projA, u1, tabB)).kind).toBe("locked");
    // Reclaim never steals from another user.
    expect((await claimLock(orgA, projA, u2, randomUUID(), false, true)).kind).toBe("locked");
    await claimLock(orgA, projA, u1, tabA, false, true);
    // The other tab's release (pagehide) does not free the holder's lock.
    await releaseLock(orgA, projA, u1, tabB);
    expect((await getSetupState(orgA, projA, u1)).lock).not.toBeNull();
    await releaseLock(orgA, projA, u1, tabA);
    expect((await getSetupState(orgA, projA, u1)).lock).toBeNull();
    expect((await claimLock(orgA, projA, u1, tabB)).kind).toBe("ok");
  });

  it("takeover moves the lock to the taker's tab, so the old tab turns read-only", async () => {
    const old = randomUUID();
    const taker = randomUUID();
    await claimLock(orgA, projA, u1, old);
    expect((await claimLock(orgA, projA, u2, taker, true)).kind).toBe("ok");
    expect((await claimLock(orgA, projA, u1, old)).kind).toBe("locked");
    expect(await updateSetupState(orgA, projA, u1, { currentStep: "app" }, null, old)).toMatchObject({ kind: "locked" });
  });

  it("another org cannot take a project's lock", async () => {
    await claimLock(orgA, projA, u1, null);
    await client`UPDATE project_setup_state SET locked_by_user_id = NULL, locked_at = NULL`;
    const cross = await claimLock(orgB, projA, u2, null);
    expect(cross.kind).toBe("locked");
    const [row] = await client`SELECT locked_by_user_id FROM project_setup_state WHERE project_id = ${projA}`;
    expect(row!.locked_by_user_id).toBeNull();
  });
});

describe("check constraints", () => {
  it("reject a bad status and a bad persona", async () => {
    await expect(client`INSERT INTO project_setup_state (id, organization_id, project_id, status) VALUES (${uuidv7()}, ${orgA}, ${projA}, 'bogus')`).rejects.toThrow(/project_setup_state_status_check/);
    await expect(client`INSERT INTO user_preferences (user_id, persona) VALUES (${u1}, 'wizard')`).rejects.toThrow(/user_preferences_persona_check/);
  });
});

describe("user preferences", () => {
  it("seen is true once a row exists, persona null means skipped", async () => {
    expect(await getUserPreferences(u1)).toEqual({ persona: null, seen: false });
    expect(await setUserPersona(u1, null)).toEqual({ persona: null, seen: true });
    expect(await getUserPreferences(u1)).toEqual({ persona: null, seen: true });
    await setUserPersona(u1, "qa");
    await setUserPersona(u1, "sre");
    expect(await getUserPreferences(u1)).toEqual({ persona: "sre", seen: true });
    expect(await getUserPreferences(u2)).toEqual({ persona: null, seen: false });
  });
});

describe("getChecklistCounts", () => {
  it("counts only the project's rows, in one query", async () => {
    const id = () => uuidv7();
    const [monId, hbId, delId, pageId, jobId, delJobId, otherJob] = [id(), id(), id(), id(), id(), id(), id()];
    await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target) VALUES
      (${monId}, ${orgA}, ${projA}, 'm', 'http_request', 'https://a.io'),
      (${hbId}, ${orgA}, ${projA}, 'hb', 'heartbeat', 'hb'),
      (${id()}, ${orgA}, ${projA2}, 'other project', 'http_request', 'https://b.io'),
      (${id()}, ${orgB}, ${projB}, 'other org', 'http_request', 'https://c.io')`;
    await client`INSERT INTO monitors (id, organization_id, project_id, name, type, target, deleting_at) VALUES (${delId}, ${orgA}, ${projA}, 'gone', 'http_request', 'https://d.io', now())`;
    await client`INSERT INTO notification_providers (id, organization_id, project_id, name, type, config) VALUES
      (${id()}, ${orgA}, ${projA}, 'n', 'email', '{}'::jsonb), (${id()}, ${orgA}, ${projA2}, 'n', 'email', '{}'::jsonb)`;
    await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain) VALUES
      (${pageId}, ${orgA}, ${projA}, 's', ${`s${randomUUID().slice(0, 8)}`}), (${id()}, ${orgB}, ${projB}, 's', ${`s${randomUUID().slice(0, 8)}`})`;
    // An archived page does not count as a status page.
    await client`INSERT INTO status_pages (id, organization_id, project_id, name, subdomain, status) VALUES (${id()}, ${orgA}, ${projA}, 'old', ${`s${randomUUID().slice(0, 8)}`}, 'archived')`;
    await client`INSERT INTO tests (id, organization_id, project_id, title, script, type) VALUES (${id()}, ${orgA}, ${projA}, 't', 's', 'browser'), (${id()}, ${orgB}, ${projB}, 't', 's', 'browser')`;
    await client`INSERT INTO jobs (id, organization_id, project_id, name) VALUES (${jobId}, ${orgA}, ${projA}, 'j'), (${otherJob}, ${orgB}, ${projB}, 'j')`;
    await client`INSERT INTO jobs (id, organization_id, project_id, name, deleting_at) VALUES (${delJobId}, ${orgA}, ${projA}, 'gone', now())`;
    await client`INSERT INTO sre_services (id, organization_id, project_id, name) VALUES (${id()}, ${orgA}, ${projA}, 'svc'), (${id()}, ${orgA}, ${projA}, 'merged-svc'), (${id()}, ${orgB}, ${projB}, 'x')`;
    await client`UPDATE sre_services SET status = 'merged' WHERE name = 'merged-svc'`;
    await client`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${id()}, ${orgA}, ${u1}, 'org_owner', now()), (${id()}, ${orgB}, ${u2}, 'org_owner', now())`;
    await client`INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id) VALUES
      (${id()}, ${orgA}, 'p@example.com', 'project_viewer', 'pending', now() + interval '1 day', ${u1}),
      (${id()}, ${orgA}, 'e@example.com', 'project_viewer', 'pending', now() - interval '1 day', ${u1}),
      (${id()}, ${orgA}, 'a@example.com', 'project_viewer', 'accepted', now() + interval '1 day', ${u1})`;
    await client`INSERT INTO apikey (id, user_id, project_id, key, enabled, created_at, updated_at) VALUES
      (${id()}, ${u1}, ${projA}, 'h1', true, now(), now()),
      (${id()}, ${u1}, ${projA2}, 'h2', true, now(), now())`;
    await client`INSERT INTO apikey (id, user_id, project_id, job_id, key, enabled, created_at, updated_at) VALUES (${id()}, ${u1}, ${projA}, ${jobId}, 'h3', true, now(), now())`;
    // A disabled and an expired CLI token do not count.
    await client`INSERT INTO apikey (id, user_id, project_id, key, enabled, created_at, updated_at) VALUES (${id()}, ${u1}, ${projA}, 'h4', false, now(), now())`;
    await client`INSERT INTO apikey (id, user_id, project_id, key, enabled, expires_at, created_at, updated_at) VALUES (${id()}, ${u1}, ${projA}, 'h5', true, now() - interval '1 day', now(), now())`;

    expect(await getChecklistCounts(orgA, projA)).toEqual({
      monitors: 2, heartbeatMonitors: 1, notificationProviders: 1, statusPages: 1, requirements: 0, tests: 1, jobs: 1,
      connectorsOrAgents: 0, services: 1, membersAndInvites: 2, cliTokens: 1, pushDevices: 0,
    });
    // Wrong org for the project sees nothing project-scoped.
    expect(await getChecklistCounts(orgB, projA)).toMatchObject({ monitors: 0, tests: 0, jobs: 0, services: 0, cliTokens: 1 });
  });
});

describe("monitorsRemaining", () => {
  it("returns the plan's remaining, 0 when blocked, null when uncapped", async () => {
    expect(await monitorsRemaining(orgA)).toBe(2);
    (checkMonitorLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, limit: 5, currentCount: 5 });
    expect(await monitorsRemaining(orgA)).toBe(0);
    // A plan that could not be read is unknown, not "0 more".
    (checkMonitorLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, requiresSubscription: true });
    expect(await monitorsRemaining(orgA)).toBeNull();
    (checkMonitorLimit as jest.Mock).mockResolvedValueOnce({ allowed: true });
    expect(await monitorsRemaining(orgA)).toBeNull();
  });
});

describe("releaseAiRun", () => {
  const lastAiRunAt = async () => (await client`SELECT last_ai_run_at FROM project_setup_state WHERE project_id = ${projA}`)[0]?.last_ai_run_at ?? null;

  it("restores the pre-claim value only while the row still holds this claim", async () => {
    const claim = await claimAiRun(orgA, projA);
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await releaseAiRun(orgA, projA, claim);
    expect(await lastAiRunAt()).toBeNull();

    const stale = await claimAiRun(orgA, projA);
    if (stale.kind !== "claimed") throw new Error("expected claim");
    const newer = new Date(stale.claimedAt.getTime() + 5000);
    await client`UPDATE project_setup_state SET last_ai_run_at = ${newer.toISOString()}::timestamptz WHERE project_id = ${projA}`;
    await releaseAiRun(orgA, projA, stale);
    expect(new Date(await lastAiRunAt()).getTime()).toBe(newer.getTime());
  });

  it("waits for the advisory lock a concurrent claim holds", async () => {
    const claim = await claimAiRun(orgA, projA);
    if (claim.kind !== "claimed") throw new Error("expected claim");
    let released = false;
    let pending: Promise<void> = Promise.resolve();
    await client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`setup-ai-run:${projA}`}))`;
      pending = releaseAiRun(orgA, projA, claim).then(() => void (released = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(released).toBe(false);
    });
    await pending;
    expect(released).toBe(true);
    expect(await lastAiRunAt()).toBeNull();
  });
});

describe("saveSuggestions", () => {
  it("merges into draft.tests without touching other keys, bumps updated_at, scopes by org", async () => {
    const first = await updateSetupState(orgA, projA, u1, { draft: { app: { url: "https://a.io/x" }, tests: { requirements: [{ title: "Keep" }] } } }, null);
    if (first.kind !== "ok") throw new Error("expected ok");
    await saveSuggestions(orgA, projA, [{ title: "S1", description: "d", priority: "high" }]);
    const after = await getSetupState(orgA, projA, u1);
    expect(after.draft).toEqual({
      app: { url: "https://a.io/x" },
      tests: { requirements: [{ title: "Keep" }], suggestions: [{ title: "S1", description: "d", priority: "high" }] },
    });
    expect(after.updatedAt).not.toBe(first.state.updatedAt);
    // A client holding the old version now conflicts instead of overwriting.
    expect((await updateSetupState(orgA, projA, u1, { currentStep: "tests" }, first.state.updatedAt)).kind).toBe("conflict");

    await saveSuggestions(orgB, projA, [{ title: "Other org" }]);
    expect((await getSetupState(orgA, projA, u1)).draft.tests?.suggestions).toEqual([{ title: "S1", description: "d", priority: "high" }]);
  });
  it("works on a row created by the AI claim (empty draft) and rejects invalid items", async () => {
    await claimAiRun(orgA, projA);
    await saveSuggestions(orgA, projA, [{ title: "S1" }]);
    expect((await getSetupState(orgA, projA, u1)).draft).toEqual({ tests: { requirements: [], suggestions: [{ title: "S1" }] } });
    await expect(saveSuggestions(orgA, projA, [{ title: "" }])).rejects.toThrow();
  });
});
