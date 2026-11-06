"use server";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sreChatConversations, sreChatMessages } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { archiveSreConversation, SRE_MESSAGE_INTERRUPTED, SRE_MESSAGE_SUPERSEDED } from "@/sre/lib/session-store";
import { db } from "@/utils/db";

// Newest messages kept per chat in the history list.
const MESSAGES_PER_CHAT = 200;

const archiveCopilotChatSchema = z.object({
  conversationId: z.string().uuid(),
});

export type SreCopilotChatHistory = {
  conversationId: string;
  title: string | null;
  incidentId: string | null;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    modelId: string | null;
    interrupted?: boolean;
  }>;
};

/**
 * The newest 30 chats of the project, plus the newest chat of `incidentId` when it fell outside that
 * limit, so an incident's thread is never lost behind newer chats.
 */
export async function getSreCopilotChatHistories(incidentId?: string | null): Promise<
  | { success: true; histories: SreCopilotChatHistory[] }
  | { success: false; error: string; histories: [] }
> {
  try {
    const parsedIncidentId = z.string().uuid().safeParse(incidentId);
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext(
      "sre_investigation",
      "investigate",
      {
        userId,
        organizationId,
        project,
      },
    );

    if (!canInvestigate) {
      return {
        success: false,
        error: "Insufficient permissions to view SRE AI chats",
        histories: [],
      };
    }

    const scopeWhere = and(
      eq(sreChatConversations.organizationId, organizationId),
      eq(sreChatConversations.projectId, project.id),
      eq(sreChatConversations.userId, userId),
      eq(sreChatConversations.status, "active"),
    );
    const conversations = await db
      .select()
      .from(sreChatConversations)
      .where(scopeWhere)
      .orderBy(desc(sreChatConversations.updatedAt))
      .limit(30);
    if (parsedIncidentId.success && !conversations.some((conversation) => conversation.incidentId === parsedIncidentId.data)) {
      const [incidentChat] = await db
        .select()
        .from(sreChatConversations)
        .where(and(scopeWhere, eq(sreChatConversations.incidentId, parsedIncidentId.data)))
        .orderBy(desc(sreChatConversations.updatedAt))
        .limit(1);
      if (incidentChat) conversations.push(incidentChat);
    }

    // One query for every conversation's newest messages (not one query per chat); superseded replies are skipped.
    const rows = conversations.length
      ? await (() => {
          const ranked = db
            .select({
              id: sreChatMessages.id,
              conversationId: sreChatMessages.conversationId,
              role: sreChatMessages.role,
              content: sreChatMessages.content,
              modelId: sreChatMessages.modelId,
              attachments: sreChatMessages.attachments,
              createdAt: sreChatMessages.createdAt,
              rank: sql<number>`row_number() over (partition by ${sreChatMessages.conversationId} order by ${sreChatMessages.createdAt} desc)`.as("rank"),
            })
            .from(sreChatMessages)
            .where(
              and(
                inArray(sreChatMessages.conversationId, conversations.map((conversation) => conversation.id)),
                sql`not (coalesce(${sreChatMessages.attachments}, '[]'::jsonb) @> ${JSON.stringify([{ type: SRE_MESSAGE_SUPERSEDED }])}::jsonb)`,
              ),
            )
            .as("ranked");
          return db.select().from(ranked).where(lte(ranked.rank, MESSAGES_PER_CHAT)).orderBy(asc(ranked.createdAt));
        })()
      : [];
    const rowsByConversation = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByConversation.set(row.conversationId, [...(rowsByConversation.get(row.conversationId) ?? []), row]);
    }

    const histories = conversations.map((conversation) => ({
      conversationId: conversation.id,
      title: conversation.title,
      incidentId: conversation.incidentId,
      updatedAt: conversation.updatedAt.toISOString(),
      messages: (rowsByConversation.get(conversation.id) ?? []).flatMap((message) => {
        if ((message.role !== "user" && message.role !== "assistant") || !message.content) return [];
        return [
          {
            id: message.id,
            role: message.role,
            content: message.content,
            modelId: message.modelId,
            interrupted: message.attachments?.some((item) => item.type === SRE_MESSAGE_INTERRUPTED) || undefined,
          },
        ];
      }),
    }));

    return { success: true, histories };
  } catch (error) {
    console.error("Error fetching Copilot chats:", error);
    return {
      success: false,
      error: "Failed to load SRE AI chat history",
      histories: [],
    };
  }
}

export async function archiveSreCopilotChat(
  input: z.input<typeof archiveCopilotChatSchema>,
) {
  const parsed = archiveCopilotChatSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false as const,
      error: "Invalid SRE AI chat archive request",
    };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext(
      "sre_investigation",
      "investigate",
      {
        userId,
        organizationId,
        project,
      },
    );

    if (!canInvestigate) {
      return {
        success: false as const,
        error: "Insufficient permissions to archive SRE AI chat",
      };
    }

    const conversation = await db.query.sreChatConversations.findFirst({
      where: and(
        eq(sreChatConversations.id, parsed.data.conversationId),
        eq(sreChatConversations.organizationId, organizationId),
        eq(sreChatConversations.projectId, project.id),
        eq(sreChatConversations.userId, userId),
      ),
      columns: { id: true },
    });

    if (!conversation) {
      return { success: false as const, error: "SRE AI chat not found" };
    }

    await archiveSreConversation({
      organizationId,
      projectId: project.id,
      userId,
      conversationId: parsed.data.conversationId,
    });

    await logAuditEvent({
      userId,
      organizationId,
      action: "sre_copilot_chat_archived",
      resource: "sre_chat_conversation",
      resourceId: parsed.data.conversationId,
      metadata: { projectId: project.id },
      success: true,
    });

    revalidatePath("/copilot");
    return { success: true as const };
  } catch (error) {
    console.error("Error archiving standalone SRE AI chat:", error);
    return { success: false as const, error: "Failed to archive SRE AI chat" };
  }
}
