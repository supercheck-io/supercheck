/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      sreIncidents: { findFirst: jest.fn() },
      sreChatConversations: { findFirst: jest.fn() },
    },
    insert: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    transaction: jest.fn(),
  },
}));

import {
  appendSreMessage,
  archiveSreConversation,
  createSreConversation,
  listSreConversations,
  SreSessionStoreError,
} from "./session-store";

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    query: {
      sreIncidents: { findFirst: jest.Mock };
      sreChatConversations: { findFirst: jest.Mock };
    };
    insert: jest.Mock;
    update: jest.Mock;
    select: jest.Mock;
    transaction: jest.Mock;
  };
};

const scope = {
  organizationId: "018f0000-0000-7000-8000-000000000001",
  projectId: "018f0000-0000-7000-8000-000000000002",
  userId: "018f0000-0000-7000-8000-000000000003",
};

describe("SRE session store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects invalid scoped inputs before querying", async () => {
    await expect(createSreConversation({ ...scope, organizationId: "bad" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("validates incident ownership before creating incident-scoped conversations", async () => {
    mockDb.query.sreIncidents.findFirst.mockResolvedValue(null);

    await expect(
      createSreConversation({
        ...scope,
        incidentId: "018f0000-0000-7000-8000-000000000004",
        title: "Investigate checkout",
      })
    ).rejects.toBeInstanceOf(SreSessionStoreError);

    expect(mockDb.query.sreIncidents.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("creates scoped conversations with normalized titles", async () => {
    mockDb.query.sreIncidents.findFirst.mockResolvedValue({ id: "incident" });
    const returning = jest.fn().mockResolvedValue([{ id: "conversation" }]);
    const values = jest.fn(() => ({ returning }));
    mockDb.insert.mockReturnValue({ values });

    const result = await createSreConversation({ ...scope, title: "  Checkout incident  " });

    expect(result).toEqual({ id: "conversation" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ title: "Checkout incident", status: "active" }));
  });

  it("appends messages only to active scoped conversations", async () => {
    const message = { id: "message" };
    const tx = {
      query: {
        sreChatConversations: { findFirst: jest.fn().mockResolvedValue({ id: "018f0000-0000-7000-8000-000000000005" }) },
      },
      insert: jest.fn(() => ({
        values: jest.fn(() => ({ returning: jest.fn().mockResolvedValue([message]) })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where: jest.fn().mockResolvedValue([]) })),
      })),
    };
    mockDb.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(
      appendSreMessage({
        ...scope,
        conversationId: "018f0000-0000-7000-8000-000000000005",
        role: "user",
        content: "What happened?",
      })
    ).resolves.toBe(message);

    expect(tx.query.sreChatConversations.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("uses scoped select chains for conversation listing and archival", async () => {
    const limit = jest.fn().mockResolvedValue([]);
    const orderBy = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ orderBy }));
    const from = jest.fn(() => ({ where }));
    mockDb.select.mockReturnValue({ from });

    await listSreConversations(scope);
    expect(where).toHaveBeenCalledTimes(1);

    const archiveReturning = jest.fn().mockResolvedValue([{ id: "conversation", status: "archived" }]);
    const archiveWhere = jest.fn(() => ({ returning: archiveReturning }));
    const archiveSet = jest.fn(() => ({ where: archiveWhere }));
    mockDb.update.mockReturnValue({ set: archiveSet });

    await expect(
      archiveSreConversation({ ...scope, conversationId: "018f0000-0000-7000-8000-000000000005" })
    ).resolves.toMatchObject({ status: "archived" });
    expect(archiveSet).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
  });
});
