export interface AutoConnectPayload {
  instanceUrl: string;
  apiKey: string;
  userId: string;
  userEmail: string;
}

export interface RecordingContextPayload {
  projectId: string;
  requirementId?: string;
  testName?: string;
  targetUrl?: string;
  returnUrl?: string;
}

export function isAllowedAppOrigin(origin: string, configuredInstanceUrl?: string): boolean {
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }

  const isSupercheckCloud = candidate.protocol === 'https:' &&
    (candidate.hostname === 'supercheck.io' || candidate.hostname.endsWith('.supercheck.io'));
  if (isSupercheckCloud)
    return true;

  // Local HTTP is intentionally limited to the exact localhost hostname.
  if (candidate.protocol === 'http:' && candidate.hostname === 'localhost')
    return true;

  if (!configuredInstanceUrl)
    return false;

  try {
    return candidate.origin === new URL(configuredInstanceUrl).origin;
  } catch {
    return false;
  }
}

export function isValidAutoConnectPayload(
  value: unknown,
  senderOrigin: string
): value is AutoConnectPayload {
  if (!value || typeof value !== 'object')
    return false;

  const payload = value as Partial<AutoConnectPayload>;
  if (
    typeof payload.instanceUrl !== 'string' ||
    typeof payload.apiKey !== 'string' || !payload.apiKey.trim() ||
    typeof payload.userId !== 'string' || !payload.userId.trim() ||
    typeof payload.userEmail !== 'string' || !payload.userEmail.trim()
  )
    return false;

  try {
    return new URL(payload.instanceUrl).origin === senderOrigin;
  } catch {
    return false;
  }
}

export function isValidRecordingContextPayload(
  value: unknown,
  senderOrigin: string
): value is RecordingContextPayload {
  if (!value || typeof value !== 'object')
    return false;

  const payload = value as Partial<RecordingContextPayload>;
  if (typeof payload.projectId !== 'string' || !payload.projectId.trim())
    return false;
  if (payload.requirementId !== undefined && typeof payload.requirementId !== 'string')
    return false;
  if (payload.testName !== undefined && typeof payload.testName !== 'string')
    return false;

  if (payload.targetUrl !== undefined) {
    if (typeof payload.targetUrl !== 'string')
      return false;
    if (payload.targetUrl !== 'about:blank') {
      try {
        const target = new URL(payload.targetUrl);
        if (target.protocol !== 'http:' && target.protocol !== 'https:')
          return false;
      } catch {
        return false;
      }
    }
  }

  if (payload.returnUrl !== undefined) {
    if (typeof payload.returnUrl !== 'string')
      return false;
    try {
      if (new URL(payload.returnUrl).origin !== senderOrigin)
        return false;
    } catch {
      return false;
    }
  }

  return true;
}
