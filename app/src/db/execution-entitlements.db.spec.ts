/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
let mockDatabase: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("@/utils/db", () => ({ get db() { return mockDatabase; } }));
jest.mock("@/lib/execution/target-domain", () => ({
  ...jest.requireActual("@/lib/execution/target-domain"), verifyTargetDns: jest.fn(),
}));
import { registerTargetDomain, verifyRegisteredTarget, requireVerifiedTarget } from "@/lib/execution/target-domain-registry";
import { verifyTargetDns } from "@/lib/execution/target-domain";
const name = `entitlements_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required for disposable database");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL); target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../..");
  await promisify(execFile)(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot, env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" }, timeout: 90000,
  });
  client = postgres(target.toString(), { max: 5, onnotice: () => {} });
  mockDatabase = drizzle(client, { schema });

}, 100000);
afterAll(async () => {
  if (client) await client.end({ timeout: 5 });
  if (maintenance) {
    await maintenance.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end({ timeout: 5 });
  }
});

it("applies the trial and verified-target tables without enabling any organization", async () => {
  expect(await client`SELECT * FROM execution_entitlements`).toHaveLength(0);
  expect(await client`SELECT * FROM execution_target_domains`).toHaveLength(0);
  expect(await client`SELECT * FROM execution_reservations`).toHaveLength(0);
});

async function createOrganization() {
  const [row] = await mockDatabase.insert(schema.organization).values({ name: "Target team", createdAt: new Date() }).returning();
  return row.id;
}
beforeEach(() => {
  jest.mocked(verifyTargetDns).mockResolvedValue(["93.184.216.34"]);
});
it("keeps DNS proofs and verified target lookup organization-scoped", async () => {
  const owner = await createOrganization();
  const foreign = await createOrganization();
  const row = await registerTargetDomain(owner, "Target.Example.com");
  expect(row.hostname).toBe("target.example.com");
  await expect(requireVerifiedTarget(owner, row.hostname)).rejects.toMatchObject({ status: 400 });
  await expect(verifyRegisteredTarget(foreign, row.id)).rejects.toMatchObject({ status: 404 });
  const verified = await verifyRegisteredTarget(owner, row.id);
  expect(verified.verifiedUntil!.getTime() - verified.verifiedAt!.getTime()).toBe(86400000);
  await expect(requireVerifiedTarget(foreign, row.hostname)).rejects.toMatchObject({ status: 400 });
  // Inside the verification window a lookup needs no DNS at all.
  jest.mocked(verifyTargetDns).mockClear();
  await expect(requireVerifiedTarget(owner, row.hostname)).resolves.toMatchObject({ id: row.id });
  expect(verifyTargetDns).not.toHaveBeenCalled();

  // Past the window the proof is re-checked, but a failed check while merely USING the target must not revoke it.
  await mockDatabase.update(schema.executionTargetDomains).set({ verifiedUntil: new Date(Date.now() - 1000) }).where(eq(schema.executionTargetDomains.id, row.id));
  jest.mocked(verifyTargetDns).mockRejectedValueOnce(new Error("proof removed"));
  await expect(requireVerifiedTarget(owner, row.hostname)).rejects.toMatchObject({ status: 400 });
  let [stored] = await mockDatabase.select().from(schema.executionTargetDomains).where(eq(schema.executionTargetDomains.id, row.id));
  expect(stored.verifiedAt).not.toBeNull();
  expect(stored.verificationToken).toBe(row.verificationToken);

  // Only an explicit verification revokes.
  jest.mocked(verifyTargetDns).mockRejectedValueOnce(new Error("proof removed"));
  await expect(verifyRegisteredTarget(owner, row.id)).rejects.toMatchObject({ status: 400 });
  [stored] = await mockDatabase.select().from(schema.executionTargetDomains).where(eq(schema.executionTargetDomains.id, row.id));
  expect(stored.verifiedAt).toBeNull();
  expect(stored.verificationToken).toBe(row.verificationToken);
});
it("serializes registration so concurrent requests cannot exceed the target quota", async () => {
  const owner = await createOrganization();
  const repeated = await Promise.all(Array.from({ length: 5 }, () => registerTargetDomain(owner, "same.example.com")));
  expect(new Set(repeated.map(row => row.id)).size).toBe(1);
  const results = await Promise.allSettled(Array.from({ length: 22 }, (_, i) => registerTargetDomain(owner, `target-${i}.example.com`)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(19);
  expect(await mockDatabase.select().from(schema.executionTargetDomains).where(eq(schema.executionTargetDomains.organizationId, owner))).toHaveLength(20);
});
it("does not restore verification after a concurrent target removal", async () => {
  const owner = await createOrganization();
  const row = await registerTargetDomain(owner, "removed.example.com");
  jest.mocked(verifyTargetDns).mockImplementationOnce(async () => {
    await mockDatabase.delete(schema.executionTargetDomains).where(eq(schema.executionTargetDomains.id, row.id));
    return ["93.184.216.34"];
  });
  await expect(verifyRegisteredTarget(owner, row.id)).rejects.toMatchObject({ status: 409 });
});
