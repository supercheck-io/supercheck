import type { Browser, Page } from '@playwright/test';
import type { APIRequest, APIRequestContext } from 'playwright-core';

type Credentials = {
  email: string;
  password: string;
};

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
    const response = await api.post('/api/auth/sign-in/email', {
      data: {
        email: credentials.email.trim(),
        password: credentials.password,
        rememberMe: true,
      },
    });

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
  const storageState = await authenticateWithApi(apiRequest, baseURL, credentials);
  const context = await browser.newContext({ baseURL, storageState });
  return context.newPage();
}
