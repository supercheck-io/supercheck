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
    let response: APIResponse | undefined;
    for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt += 1) {
      const currentResponse = await api.post('/api/auth/sign-in/email', {
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
      currentProject?: { organizationId?: string };
    };
    const organizationId = projects.currentProject?.organizationId;
    if (!organizationId) {
      throw new Error(
        `E2E identity ${credentials.email} has no active organization/project`,
      );
    }
    const activeOrganization = await api.post(
      '/api/auth/organization/set-active',
      { data: { organizationId } },
    );
    if (!activeOrganization.ok()) {
      throw new Error(
        `E2E organization activation failed for ${credentials.email} ` +
          `(${activeOrganization.status()}): ${await activeOrganization.text()}`,
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

  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}
