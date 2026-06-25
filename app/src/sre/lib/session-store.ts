import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { sreChatConversations, sreChatMessages, sreIncidents } from "@/db/schema";
import { db } from "@/utils/db";

const MAX_MESSAGE_CONTENT_LENGTH = 32_000;
const MAX_TITLE_LENGTH = 200;
const MAX_ATTACHMENTS = 10;
const MAX_EVIDENCE_IDS = 100;

const scopeSchema = z.record(z.unknown()).optional().nullable();
const attachmentsSchema = z.array(z.record(z.unknown())).max(MAX_ATTACHMENTS).optional().nullable();
const evidenceIdsSchema = z.array(z.string().uuid()).max(MAX_EVIDENCE_IDS).optional().nullable();

const sessionScopeSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
});

const createConversationSchema = sessionScopeSchema.extend({
  incidentId: z.string().uuid().optional().nullable(),
  title: z.string().trim().max(MAX_TITLE_LENGTH).optional().nullable(),
  scope: scopeSchema,
});

const conversationLookupSchema = sessionScopeSchema.extend({
  conversationId: z.string().uuid(),
});

const listConversationsSchema = sessionScopeSchema.extend({
  incidentId: z.string().uuid().optional().nullable(),
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

const appendMessageSchema = conversationLookupSchema.extend({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().max(MAX_MESSAGE_CONTENT_LENGTH).optional().nullable(),
  attachments: attachmentsSchema,
  toolCallId: z.string().uuid().optional().nullable(),
  evidenceItemIds: evidenceIdsSchema,
  investigationRunId: z.string().uuid().optional().nullable(),
  modelId: z.string().trim().max(100).optional().nullable(),
  tokenCount: z.number().int().min(0).max(1_000_000).optional().nullable(),
});

export type SreSessionScope = z.infer<typeof sessionScopeSchema>;
export type CreateSreConversationInput = z.infer<typeof createConversationSchema>;
export type ListSreConversationsInput = z.input<typeof listConversationsSchema>;
export type AppendSreMessageInput = z.infer<typeof appendMessageSchema>;

export class SreSessionStoreError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "not_found" | "incident_not_found") {
    super(message);
    this.name = "SreSessionStoreError";
  }
}

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new SreSessionStoreError("Invalid SRE session store input", "invalid_input");
  }

  return parsed.data;
}

function normalizeTitle(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : null;
}

export async function createSreConversation(input: CreateSreConversationInput) {
  const parsed = parseOrThrow(createConversationSchema, input);

  if (parsed.incidentId) {
    const incident = await db.query.sreIncidents.findFirst({
      where: and(
        eq(sreIncidents.id, parsed.incidentId),
        eq(sreIncidents.organizationId, parsed.organizationId),
        eq(sreIncidents.projectId, parsed.projectId)
      ),
      columns: { id: true },
    });

    if (!incident) {
      throw new SreSessionStoreError("Incident not found or access denied", "incident_not_found");
    }
  }

  const now = new Date();
  const [conversation] = await db
    .insert(sreChatConversations)
    .values({
      organizationId: parsed.organizationId,
      projectId: parsed.projectId,
      userId: parsed.userId,
      incidentId: parsed.incidentId ?? null,
      title: normalizeTitle(parsed.title),
      scope: parsed.scope ?? {},
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return conversation;
}

export async function getSreConversation(input: z.infer<typeof conversationLookupSchema>) {
  const parsed = parseOrThrow(conversationLookupSchema, input);

  const conversation = await db.query.sreChatConversations.findFirst({
    where: and(
      eq(sreChatConversations.id, parsed.conversationId),
      eq(sreChatConversations.organizationId, parsed.organizationId),
      eq(sreChatConversations.projectId, parsed.projectId),
      eq(sreChatConversations.userId, parsed.userId)
    ),
  });

  if (!conversation) {
    throw new SreSessionStoreError("Conversation not found or access denied", "not_found");
  }

  return conversation;
}

export async function listSreConversations(input: ListSreConversationsInput) {
  const parsed = parseOrThrow(listConversationsSchema, input);

  return db
    .select()
    .from(sreChatConversations)
    .where(
      and(
        eq(sreChatConversations.organizationId, parsed.organizationId),
        eq(sreChatConversations.projectId, parsed.projectId),
        eq(sreChatConversations.userId, parsed.userId),
        parsed.incidentId ? eq(sreChatConversations.incidentId, parsed.incidentId) : undefined,
        parsed.includeArchived ? undefined : eq(sreChatConversations.status, "active")
      )
    )
    .orderBy(desc(sreChatConversations.updatedAt))
    .limit(parsed.limit ?? 50);
}

export async function listSreMessages(input: z.infer<typeof conversationLookupSchema>) {
  const conversation = await getSreConversation(input);

  return db
    .select()
    .from(sreChatMessages)
    .where(eq(sreChatMessages.conversationId, conversation.id))
    .orderBy(asc(sreChatMessages.createdAt));
}

export async function appendSreMessage(input: AppendSreMessageInput) {
  const parsed = parseOrThrow(appendMessageSchema, input);

  return db.transaction(async (tx) => {
    const conversation = await tx.query.sreChatConversations.findFirst({
      where: and(
        eq(sreChatConversations.id, parsed.conversationId),
        eq(sreChatConversations.organizationId, parsed.organizationId),
        eq(sreChatConversations.projectId, parsed.projectId),
        eq(sreChatConversations.userId, parsed.userId),
        eq(sreChatConversations.status, "active")
      ),
      columns: { id: true },
    });

    if (!conversation) {
      throw new SreSessionStoreError("Active conversation not found or access denied", "not_found");
    }

    const now = new Date();
    const [message] = await tx
      .insert(sreChatMessages)
      .values({
        conversationId: conversation.id,
        role: parsed.role,
        content: parsed.content ?? null,
        attachments: parsed.attachments ?? [],
        toolCallId: parsed.toolCallId ?? null,
        evidenceItemIds: parsed.evidenceItemIds ?? [],
        investigationRunId: parsed.investigationRunId ?? null,
        modelId: parsed.modelId ?? null,
        tokenCount: parsed.tokenCount ?? null,
        createdAt: now,
      })
      .returning();

    await tx
      .update(sreChatConversations)
      .set({ updatedAt: now })
      .where(eq(sreChatConversations.id, conversation.id));

    return message;
  });
}

export async function archiveSreConversation(input: z.infer<typeof conversationLookupSchema>) {
  const parsed = parseOrThrow(conversationLookupSchema, input);
  const [conversation] = await db
    .update(sreChatConversations)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(sreChatConversations.id, parsed.conversationId),
        eq(sreChatConversations.organizationId, parsed.organizationId),
        eq(sreChatConversations.projectId, parsed.projectId),
        eq(sreChatConversations.userId, parsed.userId),
        or(eq(sreChatConversations.status, "active"), eq(sreChatConversations.status, "archived"))
      )
    )
    .returning();

  if (!conversation) {
    throw new SreSessionStoreError("Conversation not found or access denied", "not_found");
  }

  return conversation;
}
