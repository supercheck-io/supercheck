/** @jest-environment node */
// A soft-deleted project (status='deleted') must not resolve for CLI tokens or
// project-id routes; session auth already requires status='active'.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ authorization: "Bearer sck_live_testcredential123456789" })) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn(async () => false) }));
jest.mock("@/lib/session", () => ({ getActiveOrganization: jest.fn() }));

import { db } from "@/utils/db";
import { requireAuthContext } from "./auth-context";
import { resolveProjectPermissionContext } from "./rbac/middleware";

const dialect = new PgDialect();
const whereSql: string[] = [];
const rows = (result: unknown[]): never =>
  ({
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn((w: SQL) => { whereSql.push(dialect.sqlToQuery(w).sql); return rows(result); }),
    limit: jest.fn().mockResolvedValue(result),
  }) as never;

beforeEach(() => { whereSql.length = 0; jest.mocked(db.select).mockReset(); });

it("authenticateCliToken filters the project lookup to active projects", async () => {
  jest.mocked(db.select)
    .mockReturnValueOnce(rows([{ id: "key", userId: "user", projectId: "p", permissions: '["cli:full"]' }]))
    .mockReturnValueOnce(rows([]));
  await requireAuthContext().catch(() => undefined);
  expect(whereSql[whereSql.length - 1]).toContain('"status"');
});

it("resolveProjectPermissionContext filters the project lookup to active projects", async () => {
  jest.mocked(db.select).mockReturnValueOnce(rows([]));
  await resolveProjectPermissionContext("user", "p");
  expect(whereSql[0]).toContain('"status"');
});
