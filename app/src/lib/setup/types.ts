import type { ProjectSetupStatus, UserPersona } from "@/db/schema/project-setup";
import type { Checklist } from "./checklist";
import type { SetupFeatures } from "./features";
import type { SetupDraft } from "./draft-schema";
import type { SetupStepKey } from "./persona";

/** API contract shared by the setup routes and the client (one place, so both sides agree). */

export interface SetupLockInfo {
  userId: string;
  userName: string | null;
  lockedAt: string;
  /** True when the caller holds the lock. */
  mine: boolean;
}

export interface SetupStateDto {
  status: ProjectSetupStatus;
  currentStep: SetupStepKey | null;
  draft: SetupDraft;
  skipped: SetupStepKey[];
  statusPageOptOut: boolean;
  lock: SetupLockInfo | null;
  lastAiRunAt: string | null;
  scanResult: Record<string, unknown> | null;
  completedAt: string | null;
  dismissedAt: string | null;
  /** null until the first write; pass back as expectedUpdatedAt. */
  updatedAt: string | null;
}

export interface SetupPermissions {
  /** monitor:create: run the wizard, save the draft, take the lock. */
  canEdit: boolean;
  /** project:update: repeat-until-ack card. */
  canUpdateProject: boolean;
  /** sre_connector:configure: AI SRE step. */
  canConfigureConnectors: boolean;
  /** invitation:create */
  canInvite: boolean;
  /** test:create */
  canCreateTests: boolean;
  /** status_page:create */
  canCreateStatusPage: boolean;
  /** notification:create */
  canCreateNotification: boolean;
}

/** GET /api/projects/[id]/setup */
export interface SetupResponse {
  projectId: string;
  projectName: string;
  state: SetupStateDto;
  checklist: Checklist;
  features: SetupFeatures;
  permissions: SetupPermissions;
  /** Monitors the org can still add; null = no cap (self-hosted / unlimited). */
  monitorsRemaining: number | null;
}

/** PUT /api/projects/[id]/setup body. 409 { error: "conflict", state } on a stale expectedUpdatedAt. */
export interface SetupUpdateRequest {
  expectedUpdatedAt?: string | null;
  /** Per-tab token sent on the lock claim; a write from another tab of the same user gets 423. */
  lockToken?: string;
  status?: ProjectSetupStatus;
  currentStep?: SetupStepKey | null;
  draft?: SetupDraft;
  skipped?: SetupStepKey[];
  statusPageOptOut?: boolean;
}

/** POST|DELETE /api/projects/[id]/setup/lock body: { lockToken?: uuid, takeover?: boolean }. POST → 200 { lock } | 423 { error: "locked", lock }. DELETE → 204. */
export interface SetupLockResponse {
  lock: SetupLockInfo;
}

/** GET|PUT /api/me/preferences. `seen` = the user answered or skipped the persona question. */
export interface UserPreferencesDto {
  persona: UserPersona | null;
  seen: boolean;
}
