"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sreChatConversations, sreChatMessages } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { archiveSreConversation } from "@/sre/lib/session-store";
import { db } from "@/utils/db";

const archiveStandaloneChatSchema = z.object({
  conversationId: z.string().uuid(),
});

export type SreStandaloneChatHistory = {
  conversationId: string;
  title: string | null;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    modelId: string | null;
  }>;
};

export async function getSreStandaloneChatHistories(): Promise<
  | { success: true; histories: SreStandaloneChatHistory[] }
  | { success: false; error: string; histories: [] }
> {
  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false, error: "Insufficient permissions to view SRE AI chats", histories: [] };
    }

    const conversations = await db
      .select()
      .from(sreChatConversations)
      .where(
        and(
          eq(sreChatConversations.organizationId, organizationId),
          eq(sreChatConversations.projectId, project.id),
          eq(sreChatConversations.userId, userId),
          eq(sreChatConversations.status, "active"),
          isNull(sreChatConversations.incidentId)
        )
      )
      .orderBy(desc(sreChatConversations.updatedAt))
      .limit(30);

    const histories = await Promise.all(
      conversations.map(async (conversation) => {
        const messages = await db
          .select()
          .from(sreChatMessages)
          .where(eq(sreChatMessages.conversationId, conversation.id))
          .orderBy(asc(sreChatMessages.createdAt));

        return {
          conversationId: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt.toISOString(),
          messages: messages.flatMap((message) => {
            if ((message.role !== "user" && message.role !== "assistant") || !message.content) {
              return [];
            }

            return [{
              id: message.id,
              role: message.role,
              content: message.content,
              modelId: message.modelId,
            }];
          }),
        };
      })
    );

    return { success: true, histories };
  } catch (error) {
    console.error("Error fetching standalone SRE AI chats:", error);
    return { success: false, error: "Failed to load SRE AI chat history", histories: [] };
  }
}

export async function archiveSreStandaloneChat(input: z.input<typeof archiveStandaloneChatSchema>) {
  const parsed = archiveStandaloneChatSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: "Invalid SRE AI chat archive request" };
  }

  try {
    const { userId, organizationId, project } = await requireProjectContext();
    const canInvestigate = checkPermissionWithContext("sre_investigation", "investigate", {
      userId,
      organizationId,
      project,
    });

    if (!canInvestigate) {
      return { success: false as const, error: "Insufficient permissions to archive SRE AI chat" };
    }

    const conversation = await db.query.sreChatConversations.findFirst({
      where: and(
        eq(sreChatConversations.id, parsed.data.conversationId),
        eq(sreChatConversations.organizationId, organizationId),
        eq(sreChatConversations.projectId, project.id),
        eq(sreChatConversations.userId, userId),
        isNull(sreChatConversations.incidentId)
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
      action: "sre_standalone_chat_archived",
      resource: "sre_chat_conversation",
      resourceId: parsed.data.conversationId,
      metadata: { projectId: project.id },
      success: true,
    });

    revalidatePath("/sre-ai");
    return { success: true as const };
  } catch (error) {
    console.error("Error archiving standalone SRE AI chat:", error);
    return { success: false as const, error: "Failed to archive SRE AI chat" };
  }
}
