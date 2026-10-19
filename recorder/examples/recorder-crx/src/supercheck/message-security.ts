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

/**
 * First-party Supercheck deployments the recorder connects to without setup.
 *
 * Every entry is an exact HTTPS origin and is trusted to drive the recorder:
 * a page on one of these origins can receive the extension credential through
 * the auto-connect handshake. Keep the list explicit (no wildcards) and review
 * new entries like a security change. Update `docs/content/docs/recorder/index.mdx`
 * in the same change so the documented hosts never drift from the code.
 */
export const SUPERCHECK_CLOUD_ORIGINS = [
  'https://app.supercheck.io',
  'https://supercheck.io',
  'https://demo.supercheck.dev',
  'https://qa.superset.io',
] as const;

function parseOrigin(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/**
 * True when `origin` is exactly one of the first-party deployments above.
 */
export function isSupercheckCloudOrigin(origin: string): boolean {
  const candidate = parseOrigin(origin);
  if (!candidate || candidate.protocol !== 'https:')
    return false;

  return (SUPERCHECK_CLOUD_ORIGINS as readonly string[]).includes(candidate.origin);
}

/**
 * Origins allowed to talk to the recorder: first-party deployments plus the
 * instance the user configured explicitly in the options page.
 */
export function isAllowedAppOrigin(origin: string, configuredInstanceUrl?: string): boolean {
  if (isSupercheckCloudOrigin(origin))
    return true;

  if (!configuredInstanceUrl)
    return false;

  const candidate = parseOrigin(origin);
  const configured = parseOrigin(configuredInstanceUrl);
  if (!candidate || !configured)
    return false;

  return candidate.origin === configured.origin;
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
