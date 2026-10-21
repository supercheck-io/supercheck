import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { verification } from "@/db/schema";
import { getSelectableProjects } from "@/lib/session";
import { MCP_PROJECT_SELECTION_TTL_SECONDS } from "./config";

/**
 * The connect screen asks which project an agent may read. Better Auth stores
 * consent per "reference id", computed from the session when consent is
 * recorded, so the choice is parked here for a few minutes, keyed to the
 * browser session. It is kept off `session.activeProjectId` so connecting an
 * agent never switches the project the user is working in.
 */
const selectionIdentifier = (sessionId: string) => `mcp-project:${sessionId}`;

export class McpProjectAccessError extends Error {
  constructor() {
    super("You do not have access to that project");
    this.name = "McpProjectAccessError";
  }
}

/** Projects the user may hand to an agent: any active project they can view. */
export async function listConnectableProjects(userId: string) {
  return getSelectableProjects(userId);
}

async function assertCanConnect(userId: string, projectId: string): Promise<void> {
  const projects = await listConnectableProjects(userId);
  if (!projects.some((project) => project.id === projectId)) {
    throw new McpProjectAccessError();
  }
}

export async function saveProjectSelection(input: {
  sessionId: string;
  userId: string;
  projectId: string;
}): Promise<void> {
  await assertCanConnect(input.userId, input.projectId);

  const identifier = selectionIdentifier(input.sessionId);
  const now = new Date();
  const value = JSON.stringify({ userId: input.userId, projectId: input.projectId });
  const expiresAt = new Date(now.getTime() + MCP_PROJECT_SELECTION_TTL_SECONDS * 1000);

  await db.transaction(async (tx) => {
    await tx.delete(verification).where(eq(verification.identifier, identifier));
    await tx.insert(verification).values({ identifier, value, expiresAt, createdAt: now, updatedAt: now });
  });
}

/**
 * The project chosen for this browser session, or undefined when none was
 * chosen, it expired, or the user lost access since. Access is re-checked every
 * time because consent is granted against live membership.
 */
export async function readProjectSelection(input: {
  sessionId: string;
  userId: string;
}): Promise<string | undefined> {
  const [row] = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, selectionIdentifier(input.sessionId)))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as { userId?: unknown }).userId !== input.userId ||
    typeof (parsed as { projectId?: unknown }).projectId !== "string"
  ) {
    return undefined;
  }

  const projectId = (parsed as { projectId: string }).projectId;
  try {
    await assertCanConnect(input.userId, projectId);
  } catch {
    return undefined;
  }
  return projectId;
}

export async function clearProjectSelection(sessionId: string): Promise<void> {
  await db
    .delete(verification)
    .where(eq(verification.identifier, selectionIdentifier(sessionId)));
}
