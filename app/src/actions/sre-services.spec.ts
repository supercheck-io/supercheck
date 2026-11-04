/** @jest-environment node */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));

import { PgDialect } from "drizzle-orm/pg-core";
import { requireProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { getSreServices } from "./sre-services";

it("lists only active services, hiding archived (deprecated) and merged ones", async () => {
  jest.mocked(requireProjectContext).mockResolvedValue({
    userId: "u", organizationId: "org-1", project: { id: "project-1" },
  } as never);
  const where = jest.fn(() => ({ orderBy: async () => [] }));
  (db.select as jest.Mock).mockReturnValue({ from: () => ({ where }) });
  expect(await getSreServices()).toEqual({ success: true, services: [] });
  const query = new PgDialect().sqlToQuery((where.mock.calls[0] as unknown[])[0] as never);
  expect(query.params).toEqual(expect.arrayContaining(["org-1", "project-1", "active"]));
  expect(query.sql).not.toContain("<>");
});
