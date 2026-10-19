import type { Browser, Page } from '@playwright/test';
import type { APIRequest, APIRequestContext, APIResponse } from 'playwright-core';

type Credentials = {
  email: string;
  password: string;
};

type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

// Role fixtures create a fresh browser context for every test, but they do not
// need to create a fresh server-side session every time. Reusing the immutable
// storage-state snapshot keeps the full suite below production auth rate limits.
const roleStorageStates = new Map<string, Promise<StorageState>>();

const AUTH_MAX_ATTEMPTS = 3;
const AUTH_RETRY_FALLBACK_SECONDS = 2;
const AUTH_RETRY_MAX_SECONDS = 30;

// Longest shell we are willing to sit out inside a single test. The demo
// escalates to 5/15/60-minute lockouts, and those mean the run cannot proceed
// with the shared identity, so they must fail loudly instead of stalling.
const AUTH_LOCKOUT_MAX_WAIT_SECONDS = 35;

type SignInLockoutState = {
  isLocked?: boolean;
  lockoutSeconds?: number;
  message?: string;
};

/**
 * Wait out an active login lockout before a sign-in is attempted.
 *
 * The demo enforces a progressive lockout (30s after 5 failed attempts, then
 * 5/15/60 minutes). A locked identity is rejected by the sign-in pre-check
 * before any credential request is sent, so a naive sign-in cannot tell a
 * lockout from a broken form: it just times out waiting for a redirect.
 * Returns true when the caller had to wait, false when the identity was free.
 */
export async function waitForSignInUnlocked(
  request: APIRequestContext,
  email: string,
  maxWaitSeconds = AUTH_LOCKOUT_MAX_WAIT_SECONDS,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitSeconds * 1_000;
  let waited = false;

  for (;;) {
    // A failing pre-check must not become a new failure mode: fall through to
    // the sign-in attempt, which reports the authoritative result.
    const response = await request
      .post('/api/auth/sign-in/check', {
        data: { action: 'pre-check', email: email.trim() },
      })
      .catch(() => null);
    if (!response) {
      return waited;
    }
    const state = (await response.json().catch(() => ({}))) as SignInLockoutState;

    if (!state.isLocked) {
      return waited;
    }

    const remainingMs = Math.min(
      (state.lockoutSeconds ?? AUTH_RETRY_FALLBACK_SECONDS) * 1_000 + 250,
      deadline - Date.now(),
    );
    if (remainingMs <= 0) {
      throw new Error(
        `E2E sign-in for ${email} stayed locked longer than ${maxWaitSeconds}s: ` +
          `${state.message ?? 'no lockout detail returned'}`,
      );
    }

    waited = true;
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
}

function getAuthRetryDelayMs(response: APIResponse, attempt: number) {
  const retryAfterHeader =
    response.headers()['retry-after'] ?? response.headers()['x-retry-after'];
  const retryAfterSeconds = Number.parseInt(retryAfterHeader ?? '', 10);
  const boundedSeconds = Number.isFinite(retryAfterSeconds)
    ? Math.min(Math.max(retryAfterSeconds, 1), AUTH_RETRY_MAX_SECONDS)
    : Math.min(AUTH_RETRY_FALLBACK_SECONDS ** attempt, AUTH_RETRY_MAX_SECONDS);

  // Add a small boundary cushion because providers commonly round retry hints down.
  return boundedSeconds * 1_000 + 250;
}

/**
 * Sign in through Better Auth with bounded retries for its per-IP window.
 * Returns the final response so callers can keep their own assertions.
 */
export async function signInWithRetry(
  request: APIRequestContext,
  credentials: Credentials,
): Promise<APIResponse> {
  let response: APIResponse | undefined;

  // Failed logins from other specs (enumeration, injection, invite flows) share
  // the identity and the runner IP, so a lockout can be active before we start.
  await waitForSignInUnlocked(request, credentials.email);

  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt += 1) {
    const currentResponse = await request.post('/api/auth/sign-in/email', {
      data: {
        email: credentials.email.trim(),
        password: credentials.password,
        rememberMe: true,
      },
    });
    response = currentResponse;

    if (currentResponse.status() !== 429 || attempt === AUTH_MAX_ATTEMPTS) {
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, getAuthRetryDelayMs(currentResponse, attempt)),
    );
  }

  if (!response) {
    throw new Error('E2E API authentication did not return a response');
  }

  return response;
}

export async function authenticateWithApi(
  apiRequest: APIRequest,
  baseURL: string,
  credentials: Credentials,
  options: { requireProjectContext?: boolean } = {},
): Promise<Awaited<ReturnType<APIRequestContext['storageState']>>> {
  const origin = new URL(baseURL).origin;
  const api = await apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: {
      Origin: origin,
      Referer: `${origin}/sign-in`,
    },
  });

  try {
    const response = await signInWithRetry(api, credentials);

    if (!response.ok()) {
      throw new Error(
        `E2E API authentication failed for ${credentials.email} ` +
          `(${response.status()}): ${await response.text()}`,
      );
    }

    if (options.requireProjectContext === false) {
      return await api.storageState();
    }

    const projectsResponse = await api.get('/api/projects');
    if (!projectsResponse.ok()) {
      throw new Error(
        `E2E project-context initialization failed for ${credentials.email} ` +
          `(${projectsResponse.status()}): ${await projectsResponse.text()}`,
      );
    }
    const projects = (await projectsResponse.json()) as {
      currentProject?: { id?: string; organizationId?: string };
    };
    const currentProject = projects.currentProject;
    if (!currentProject?.id || !currentProject.organizationId) {
      throw new Error(
        `E2E identity ${credentials.email} has no active organization/project`,
      );
    }
    // Direct Better Auth organization operations are disabled; selecting the
    // active tenant must go through the application API, which sets the
    // organization and project scopes together under app RBAC.
    const activeProject = await api.post('/api/projects/switch', {
      data: { projectId: currentProject.id },
    });
    if (!activeProject.ok()) {
      throw new Error(
        `E2E project activation failed for ${credentials.email} ` +
          `(${activeProject.status()}): ${await activeProject.text()}`,
      );
    }

    return await api.storageState();
  } finally {
    await api.dispose();
  }
}

export async function newAuthenticatedPage(
  browser: Browser,
  apiRequest: APIRequest,
  baseURL: string,
  credentials: Credentials,
): Promise<Page> {
  const cacheKey = `${new URL(baseURL).origin}:${credentials.email.trim().toLowerCase()}`;
  let storageStatePromise = roleStorageStates.get(cacheKey);
  if (!storageStatePromise) {
    storageStatePromise = authenticateWithApi(apiRequest, baseURL, credentials);
    roleStorageStates.set(cacheKey, storageStatePromise);
  }

  let storageState: StorageState;
  try {
    storageState = await storageStatePromise;
  } catch (error) {
    roleStorageStates.delete(cacheKey);
    throw error;
  }

  const origin = new URL(baseURL).origin;
  const context = await browser.newContext({
    baseURL,
    storageState,
    // Same-origin guarded APIs (for example project switching) reject
    // APIRequestContext calls that do not send an explicit Origin.
    extraHTTPHeaders: {
      Origin: origin,
      Referer: `${origin}/sign-in`,
    },
  });
  return context.newPage();
}
