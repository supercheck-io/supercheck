import { AsyncLocalStorage } from "node:async_hooks";
import { getSelectableProjects } from "@/lib/session";

/**
 * The connect screen asks which project an agent may read, and Better Auth
 * records consent against a "reference id" it computes while handling the
 * approval. That computation gets only the user and session, not the request.
 *
 * The chosen project therefore travels with the one in-process approval call
 * (AsyncLocalStorage) instead of through shared storage. Two connect screens
 * open in the same browser session each run their own call with their own
 * project, so one can never read, overwrite or clear the other's choice. It
 * also keeps the choice off `session.activeProjectId`, so connecting an agent
 * never switches the project the user is working in.
 */
interface ConsentProject {
  userId: string;
  projectId: string;
}

// One store per process, kept on globalThis. Next.js can bundle this module more than once (the
// consent route and the auth module are separate bundles), and a store created per copy would
// leave the code that sets the project and the code that reads it looking at different stores.
const STORE_KEY = Symbol.for("supercheck.mcp.consent-project");
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: AsyncLocalStorage<ConsentProject> };
const storage = (globalStore[STORE_KEY] ??= new AsyncLocalStorage<ConsentProject>());

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

export async function assertCanConnectProject(userId: string, projectId: string): Promise<void> {
  const projects = await listConnectableProjects(userId);
  if (!projects.some((project) => project.id === projectId)) {
    throw new McpProjectAccessError();
  }
}

/** Runs `fn` (the approval call) with `projectId` as the project being connected. */
export function runWithConsentProject<T>(selection: ConsentProject, fn: () => Promise<T>): Promise<T> {
  return storage.run(selection, fn);
}

/**
 * The project being connected by the approval in progress, or undefined when
 * there is none (an authorization request that is only looking up existing
 * consent) or the user no longer has access. Access is re-checked because
 * consent is granted against live membership.
 */
export async function resolveConsentProject(input: { userId: string }): Promise<string | undefined> {
  const selection = storage.getStore();
  if (!selection || selection.userId !== input.userId) return undefined;
  try {
    await assertCanConnectProject(selection.userId, selection.projectId);
  } catch (error) {
    // Lost access means no choice. Anything else (a database error, a timeout)
    // must surface rather than read as "no project chosen".
    if (error instanceof McpProjectAccessError) return undefined;
    throw error;
  }
  return selection.projectId;
}
