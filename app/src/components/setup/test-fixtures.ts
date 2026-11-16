import { SETUP_FEATURES, type SetupFeatures } from "@/lib/setup/features";
import type { SetupResponse } from "@/lib/setup/types";
import type { StepProps } from "./steps/step-types";

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

export const FEATURES: SetupFeatures = { ...SETUP_FEATURES };

export function makeResponse(overrides: Partial<SetupResponse> = {}, state: Partial<SetupResponse["state"]> = {}): SetupResponse {
  return {
    projectId: PROJECT_ID,
    projectName: "Web App",
    state: {
      status: "not_started",
      currentStep: null,
      draft: {},
      skipped: [],
      statusPageOptOut: false,
      lock: null,
      lastAiRunAt: null,
      scanResult: null,
      completedAt: null,
      dismissedAt: null,
      updatedAt: null,
      ...state,
    },
    checklist: {
      items: [
        { key: "monitors", group: "watch", title: "Uptime and SSL monitors", done: true, href: "/monitors" },
        { key: "alerts", group: "watch", title: "Alert channel", done: false, href: "/notifications" },
      ],
      done: 1,
      total: 2,
      nextSteps: [{ key: "incident", title: "Practice: open a manual incident", href: "/incidents?new=1" }],
    },
    features: FEATURES,
    permissions: {
      canEdit: true,
      canUpdateProject: true,
      canConfigureConnectors: false,
      canInvite: true,
      canCreateTests: true,
      canCreateStatusPage: true,
      canCreateNotification: true,
    },
    monitorsRemaining: null,
    aiTestsLocked: false,
    ...overrides,
  };
}

export function makeStepProps(overrides: Partial<StepProps> = {}): StepProps {
  const response = makeResponse();
  return {
    response,
    features: FEATURES,
    permissions: response.permissions,
    draft: {},
    patchDraft: jest.fn(),
    setStatusPageOptOut: jest.fn(),
    readOnly: false,
    userEmail: "me@example.com",
    scan: null,
    setScan: jest.fn(),
    ...overrides,
  };
}
