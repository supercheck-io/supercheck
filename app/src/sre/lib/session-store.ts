import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  sreChatConversations,
  sreChatMessages,
  sreIncidents,
} from "@/db/schema";
import { db } from "@/utils/db";

/** Attachment markers: an interrupted reply stays out of prompts; a superseded one was replaced by a regenerated reply. */
export const SRE_MESSAGE_INTERRUPTED = "interrupted";
export const SRE_MESSAGE_SUPERSEDED = "superseded";
export const isSreMessageSuperseded = (row: { attachments: Record<string, unknown>[] | null }) =>
  Boolean(row.attachments?.some((item) => item.type === SRE_MESSAGE_SUPERSEDED));

const MAX_MESSAGE_CONTENT_LENGTH = 32_000;
const MAX_TITLE_LENGTH = 200;
const MAX_ATTACHMENTS = 10;
const MAX_EVIDENCE_IDS = 100;

const scopeSchema = z.record(z.string(), z.unknown()).optional().nullable();
const attachmentsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .max(MAX_ATTACHMENTS)
  .optional()
  .nullable();
const evidenceIdsSchema = z
  .array(z.string().uuid())
  .max(MAX_EVIDENCE_IDS)
  .optional()
  .nullable();

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
  id: z.string().uuid().optional(),
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
export type CreateSreConversationInput = z.infer<
  typeof createConversationSchema
>;
export type ListSreConversationsInput = z.input<typeof listConversationsSchema>;
export type AppendSreMessageInput = z.infer<typeof appendMessageSchema>;

export class SreSessionStoreError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "incident_not_found",
  ) {
    super(message);
    this.name = "SreSessionStoreError";
  }
}

function parseOrThrow<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new SreSessionStoreError(
      "Invalid SRE session store input",
      "invalid_input",
    );
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
        eq(sreIncidents.projectId, parsed.projectId),
      ),
      columns: { id: true },
    });

    if (!incident) {
      throw new SreSessionStoreError(
        "Incident not found or access denied",
        "incident_not_found",
      );
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

export async function getSreConversation(
  input: z.infer<typeof conversationLookupSchema>,
) {
  const parsed = parseOrThrow(conversationLookupSchema, input);

  const conversation = await db.query.sreChatConversations.findFirst({
    where: and(
      eq(sreChatConversations.id, parsed.conversationId),
      eq(sreChatConversations.organizationId, parsed.organizationId),
      eq(sreChatConversations.projectId, parsed.projectId),
      eq(sreChatConversations.userId, parsed.userId),
    ),
  });

  if (!conversation) {
    throw new SreSessionStoreError(
      "Conversation not found or access denied",
      "not_found",
    );
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
        parsed.incidentId
          ? eq(sreChatConversations.incidentId, parsed.incidentId)
          : undefined,
        parsed.includeArchived
          ? undefined
          : eq(sreChatConversations.status, "active"),
      ),
    )
    .orderBy(desc(sreChatConversations.updatedAt))
    .limit(parsed.limit ?? 50);
}

/** With `limit`, returns the newest `limit` messages, still oldest first. */
export async function listSreMessages(
  input: z.infer<typeof conversationLookupSchema> & { limit?: number },
) {
  const { limit, ...lookup } = input;
  const conversation = await getSreConversation(lookup);
  const base = db
    .select()
    .from(sreChatMessages)
    .where(eq(sreChatMessages.conversationId, conversation.id));
  if (!limit) return base.orderBy(asc(sreChatMessages.createdAt));
  const newest = await base.orderBy(desc(sreChatMessages.createdAt)).limit(limit);
  return newest.reverse();
}

/** Messages of one conversation by id; ids outside the conversation are simply not returned. */
export async function listSreMessagesByIds(
  input: z.infer<typeof conversationLookupSchema> & { messageIds: string[] },
) {
  const { messageIds, ...lookup } = input;
  const conversation = await getSreConversation(lookup);
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(sreChatMessages)
    .where(
      and(
        eq(sreChatMessages.conversationId, conversation.id),
        inArray(sreChatMessages.id, messageIds),
      ),
    );
}

/** `supersedeMessageId` flags the replaced reply in the same transaction as the new one. */
export async function appendSreMessage(input: AppendSreMessageInput, options: { supersedeMessageId?: string } = {}) {
  const parsed = parseOrThrow(appendMessageSchema, input);

  return db.transaction(async (tx) => {
    const conversation = await tx.query.sreChatConversations.findFirst({
      where: and(
        eq(sreChatConversations.id, parsed.conversationId),
        eq(sreChatConversations.organizationId, parsed.organizationId),
        eq(sreChatConversations.projectId, parsed.projectId),
        eq(sreChatConversations.userId, parsed.userId),
        eq(sreChatConversations.status, "active"),
      ),
      columns: { id: true },
    });

    if (!conversation) {
      throw new SreSessionStoreError(
        "Active conversation not found or access denied",
        "not_found",
      );
    }

    const now = new Date();
    const [message] = await tx
      .insert(sreChatMessages)
      .values({
        id: parsed.id,
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

    if (options.supersedeMessageId) {
      await flagSuperseded(tx, conversation.id, options.supersedeMessageId);
    }

    return message;
  });
}

/** Flags a reply replaced by a regeneration so later prompts and reloaded history skip it. */
export async function markSreMessageSuperseded(
  input: z.infer<typeof conversationLookupSchema> & { messageId: string },
) {
  const { messageId, ...lookup } = input;
  const conversation = await getSreConversation(lookup);
  await flagSuperseded(db, conversation.id, messageId);
}

function flagSuperseded(executor: Pick<typeof db, "update">, conversationId: string, messageId: string) {
  return executor
    .update(sreChatMessages)
    .set({
      attachments: sql`coalesce(${sreChatMessages.attachments}, '[]'::jsonb) || ${JSON.stringify([{ type: SRE_MESSAGE_SUPERSEDED }])}::jsonb`,
    })
    .where(and(eq(sreChatMessages.id, messageId), eq(sreChatMessages.conversationId, conversationId)));
}

export async function archiveSreConversation(
  input: z.infer<typeof conversationLookupSchema>,
) {
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
        or(
          eq(sreChatConversations.status, "active"),
          eq(sreChatConversations.status, "archived"),
        ),
      ),
    )
    .returning();

  if (!conversation) {
    throw new SreSessionStoreError(
      "Conversation not found or access denied",
      "not_found",
    );
  }

  return conversation;
}
