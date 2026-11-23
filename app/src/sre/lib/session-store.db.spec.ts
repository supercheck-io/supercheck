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

import { appendSreMessage, isSreMessageSuperseded, SreSessionStoreError } from "./session-store";

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
