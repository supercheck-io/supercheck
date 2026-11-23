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
jest.mock("@/utils/db", () => ({
  get db() {
    return mockDatabase;
  },
}));

import { appendSreMessage, isSreMessageSuperseded, listSreMessages, SreSessionStoreError } from "./session-store";

const execFileAsync = promisify(execFile);
const name = `session_store_${randomUUID().replaceAll("-", "")}`;
let maintenance: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let scope: { organizationId: string; projectId: string; userId: string; conversationId: string };
let originalReplyId: string;

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required");
  maintenance = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await maintenance.unsafe(`CREATE DATABASE "${name}"`);
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.pathname = `/${name}`;
  const appRoot = path.resolve(__dirname, "../../..");
  await execFileAsync(process.execPath, [path.join(appRoot, "scripts/db-migrate.js")], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: target.toString(), SELF_HOSTED: "true", NODE_ENV: "test" },
    timeout: 90000,
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

beforeEach(async () => {
  await client`TRUNCATE organization, "user" CASCADE`;
  const [org] = await mockDatabase.insert(schema.organization).values({ name: "Org", createdAt: new Date() }).returning();
  const [project] = await mockDatabase.insert(schema.projects).values({ organizationId: org.id, name: "P" }).returning();
  const [user] = await mockDatabase.insert(schema.user).values({ name: "U", email: `${randomUUID()}@example.test` }).returning();
  const [conversation] = await mockDatabase
    .insert(schema.sreChatConversations)
    .values({ organizationId: org.id, projectId: project.id, userId: user.id })
    .returning();
  scope = { organizationId: org.id, projectId: project.id, userId: user.id, conversationId: conversation.id };
  const [original] = await mockDatabase
    .insert(schema.sreChatMessages)
    .values({ conversationId: conversation.id, role: "assistant", content: "first answer", attachments: [] })
    .returning();
  originalReplyId = original.id;
});

const regenerated = (content: string) =>
  appendSreMessage({ ...scope, role: "assistant", content }, { supersedeMessageId: originalReplyId });

const assistantRows = () =>
  mockDatabase.select().from(schema.sreChatMessages).where(eq(schema.sreChatMessages.conversationId, scope.conversationId));

it("lets only one of two concurrent regenerations replace the same reply", async () => {
  const results = await Promise.allSettled([regenerated("tab one"), regenerated("tab two")]);

  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(SreSessionStoreError);
  expect(rejected.reason).toMatchObject({ code: "already_superseded" });
  // The losing tab's reply was rolled back with its failed claim: one original (superseded) plus one regeneration.
  const rows = await assistantRows();
  expect(rows).toHaveLength(2);
  expect(rows.filter((row) => !isSreMessageSuperseded(row)).map((row) => row.content)).toHaveLength(1);
  expect(isSreMessageSuperseded(rows.find((row) => row.id === originalReplyId)!)).toBe(true);
});

it("refuses to supersede an already replaced reply and stores nothing", async () => {
  await regenerated("first regeneration");
  await expect(regenerated("late tab")).rejects.toMatchObject({ code: "already_superseded" });
  const rows = await assistantRows();
  expect(rows.map((row) => row.content).sort()).toEqual(["first answer", "first regeneration"]);
  // The marker is added once, not stacked by the failed claim.
  const original = rows.find((row) => row.id === originalReplyId)!;
  expect(original.attachments).toEqual([{ type: "superseded" }]);
});

it("refuses a reply id from another conversation", async () => {
  const [other] = await mockDatabase
    .insert(schema.sreChatConversations)
    .values({ organizationId: scope.organizationId, projectId: scope.projectId, userId: scope.userId })
    .returning();
  await expect(
    appendSreMessage({ ...scope, conversationId: other.id, role: "assistant", content: "x" }, { supersedeMessageId: originalReplyId }),
  ).rejects.toMatchObject({ code: "already_superseded" });
  expect(await mockDatabase.select().from(schema.sreChatMessages).where(eq(schema.sreChatMessages.conversationId, other.id))).toEqual([]);
});

it("keeps a regenerated reply in the replaced reply's place when the transcript is reloaded", async () => {
  // U1, A1 (seeded), then U2, A2 later; regenerate A1.
  await mockDatabase.update(schema.sreChatMessages).set({ createdAt: new Date("2026-11-20T10:00:01Z") }).where(eq(schema.sreChatMessages.id, originalReplyId));
  await mockDatabase.insert(schema.sreChatMessages).values([
    { conversationId: scope.conversationId, role: "user", content: "U1", createdAt: new Date("2026-11-20T10:00:00Z") },
    { conversationId: scope.conversationId, role: "user", content: "U2", createdAt: new Date("2026-11-20T10:05:00Z") },
    { conversationId: scope.conversationId, role: "assistant", content: "A2", createdAt: new Date("2026-11-20T10:05:01Z") },
  ]);
  await regenerated("A1 again");
  const visible = (await listSreMessages({ ...scope })).filter((row) => !isSreMessageSuperseded(row)).map((row) => row.content);
  expect(visible).toEqual(["U1", "A1 again", "U2", "A2"]);
});

it("keeps the regenerated reply in bounded history even when it ties with the replaced reply at the limit", async () => {
  await mockDatabase.update(schema.sreChatMessages).set({ createdAt: new Date("2026-11-20T10:00:00Z") }).where(eq(schema.sreChatMessages.id, originalReplyId));
  const replacement = await regenerated("replacement");
  await mockDatabase.insert(schema.sreChatMessages).values(
    Array.from({ length: 3 }, (_, i) => ({
      conversationId: scope.conversationId,
      role: "user" as const,
      content: `later ${i}`,
      createdAt: new Date(Date.parse("2026-11-20T10:01:00Z") + i * 1000),
    })),
  );
  // Limit 4 leaves exactly one slot for the original/replacement pair.
  const rows = await listSreMessages({ ...scope, limit: 4 });
  expect(rows.map((row) => row.content)).toEqual(["replacement", "later 0", "later 1", "later 2"]);
  expect(rows[0].id).toBe(replacement.id);
  // The replaced reply never takes a slot: a larger limit returns the same visible rows, not the original as well.
  expect((await listSreMessages({ ...scope, limit: 5 })).map((row) => row.content)).toEqual(["replacement", "later 0", "later 1", "later 2"]);
});
