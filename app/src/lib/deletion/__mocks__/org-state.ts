// Manual mock for route and action specs: no pending organizations, no database. Use with jest.mock("@/lib/deletion/org-state").
export const PENDING_ORG_CODE = "ORG_PENDING_DELETION";
export class OrgPendingDeletionError extends Error { readonly code = PENDING_ORG_CODE; }
export const isOrgPendingDeletion = jest.fn(async () => false);
export const isProjectDeleted = jest.fn(async () => false);
export const isProjectOrgPending = jest.fn(async () => false);
export const assertOrgWritable = jest.fn(async () => undefined);
export const invalidateOrgState = jest.fn();
export const invalidateProjectState = jest.fn();
export const clearDeletionStateCache = jest.fn();
export const isOrgPendingDeletionError = (error: unknown) => error instanceof OrgPendingDeletionError;
export const pendingDeletionResponse = () => new Response(JSON.stringify({ code: PENDING_ORG_CODE }), { status: 403 });
export const PROJECT_RESTORE_DAYS = 7;
export const permissionDeniedResponse = jest.fn(async (_organizationId: unknown, message: string) => new Response(JSON.stringify({ error: message }), { status: 403 }));
export const permissionDeniedResult = jest.fn(async (_organizationId: unknown, message: string) => ({ success: false as const, error: message, message }));
