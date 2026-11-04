/** @jest-environment node */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/sre/lib/session-store", () => ({
  SRE_MESSAGE_INTERRUPTED: "interrupted",
  SRE_MESSAGE_SUPERSEDED: "superseded",
  archiveSreConversation: jest.fn(),
}));
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    query: { sreChatConversations: { findFirst: jest.fn() } },
  },
}));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { archiveSreConversation } from "@/sre/lib/session-store";
import { getSreCopilotChatHistories, archiveSreCopilotChat } from "./sre-ai";

const { db } = jest.requireMock("@/utils/db");
const context = {
  userId: "user-1",
  organizationId: "org-1",
  project: { id: "project-1" },
};
const conversationId = "018f0000-0000-7000-8000-000000000001";

beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(requireProjectContext)
    .mockResolvedValue(
      context as Awaited<ReturnType<typeof requireProjectContext>>,
    );
  jest.mocked(checkPermissionWithContext).mockReturnValue(true);
});

it("includes incident chats in private project history", async () => {
  const where = jest.fn((_query: SQL) => ({
    orderBy: () => ({
      limit: async () => [
        {
          id: conversationId,
          incidentId: "incident-1",
          title: "Incident question",
          updatedAt: new Date("2026-10-09"),
        },
      ],
    }),
  }));
  const subquery = { as: () => ({ rank: "rank", createdAt: "createdAt" }) };
  db.select
    .mockReturnValueOnce({ from: () => ({ where }) })
    .mockReturnValueOnce({ from: () => ({ where: () => subquery }) })
    .mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: async () => [] }) }),
    });
  const result = await getSreCopilotChatHistories();
  expect(result).toMatchObject({
    success: true,
    histories: [{ conversationId, incidentId: "incident-1" }],
  });
  const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.params).toEqual(
    expect.arrayContaining([
      context.userId,
      context.organizationId,
      context.project.id,
      "active",
    ]),
  );
  expect(query.sql).not.toContain('"incident_id" is null');
});

it("returns an empty history without a message query when there are no chats", async () => {
  db.select.mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) });
  expect(await getSreCopilotChatHistories()).toEqual({ success: true, histories: [] });
  expect(db.select).toHaveBeenCalledTimes(1);
});

it("loads all chats' messages in one bounded query instead of one per chat", async () => {
  const conversations = [conversationId, "018f0000-0000-7000-8000-000000000002"].map((id, i) => ({
    id, incidentId: null, title: `Chat ${i}`, updatedAt: new Date("2026-10-09"),
  }));
  const messageWhere = jest.fn((_query: SQL) => ({ as: () => ({ rank: "rank", createdAt: "createdAt" }) }));
  const row = (id: string, conversation: string, role: string, content: string, attachments: unknown = null) => ({
    id, conversationId: conversation, role, content, modelId: null, attachments, createdAt: new Date(),
  });
  db.select
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => conversations }) }) }) })
    .mockReturnValueOnce({ from: () => ({ where: messageWhere }) })
    .mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: async () => [
            row("m1", conversations[0].id, "user", "hi"),
            row("m2", conversations[1].id, "user", "yo"),
            row("m3", conversations[0].id, "assistant", "cut", [{ type: "interrupted" }]),
          ],
        }),
      }),
    });
  const result = await getSreCopilotChatHistories();
  expect(db.select).toHaveBeenCalledTimes(3); // chats + ranked subquery + rows, regardless of chat count
  expect(result).toMatchObject({
    success: true,
    histories: [
      { conversationId: conversations[0].id, messages: [{ id: "m1" }, { id: "m3", interrupted: true }] },
      { conversationId: conversations[1].id, messages: [{ id: "m2" }] },
    ],
  });
  const query = new PgDialect().sqlToQuery(messageWhere.mock.calls[0][0]);
  expect(query.params).toEqual(expect.arrayContaining(conversations.map((c) => c.id)));
  expect(query.sql).toContain("@>"); // superseded replies are filtered out
});

it("allows an owner to archive an incident chat with the same tenant and user checks", async () => {
  db.query.sreChatConversations.findFirst.mockResolvedValue({
    id: conversationId,
  });
  expect(await archiveSreCopilotChat({ conversationId })).toEqual({
    success: true,
  });
  const query = new PgDialect().sqlToQuery(
    db.query.sreChatConversations.findFirst.mock.calls[0][0].where,
  );
  expect(query.params).toEqual(
    expect.arrayContaining([
      context.userId,
      context.organizationId,
      context.project.id,
      conversationId,
    ]),
  );
  expect(archiveSreConversation).toHaveBeenCalledWith(
    expect.objectContaining({ userId: context.userId, conversationId }),
  );
});

it("rejects chat history for a viewer before reading messages", async () => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(false);
  expect(await getSreCopilotChatHistories()).toMatchObject({
    success: false,
    histories: [],
  });
  expect(db.select).not.toHaveBeenCalled();
});

it("does not archive an inaccessible conversation", async () => {
  db.query.sreChatConversations.findFirst.mockResolvedValue(null);
  expect(await archiveSreCopilotChat({ conversationId })).toMatchObject({
    success: false,
  });
  expect(archiveSreConversation).not.toHaveBeenCalled();
});
