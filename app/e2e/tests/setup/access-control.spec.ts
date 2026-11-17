import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { Role, test } from '../../fixtures';
import { hasRbacUser } from '../../utils/env';
import { signUpFreshCreator } from '../../utils/setup-test-data';

/** Every setup route a project id reaches, with a body each would otherwise accept. */
const setupCalls = (projectId: string) => [
  { method: 'GET', url: `/api/projects/${projectId}/setup` },
  { method: 'PUT', url: `/api/projects/${projectId}/setup`, data: { status: 'in_progress' } },
  { method: 'POST', url: `/api/projects/${projectId}/setup/lock`, data: { lockToken: randomUUID() } },
  { method: 'POST', url: `/api/projects/${projectId}/setup/scan`, data: { url: 'https://example.com/' } },
  { method: 'POST', url: `/api/projects/${projectId}/setup/suggest-requirements`, data: {} },
];

// Writes carry the app's Origin, so a same-origin check is never the reason for the status a test asserts.
async function send(request: APIRequestContext, origin: string, call: { method: string; url: string; data?: unknown }, headers: Record<string, string> = {}) {
  return request.fetch(call.url, { method: call.method, data: call.data, headers: { Origin: origin, ...headers } });
}

async function currentProjectId(page: Page): Promise<string> {
  const res = await page.request.get('/api/projects');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { currentProject?: { id?: string } }).currentProject?.id ?? '';
}

test.describe('Project setup access control @setup', () => {
  test('setup routes answer 404 for a project in another organization @critical', async ({ browser, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const a = await signUpFreshCreator(browser, baseURL!, 'xorg-a');
    const b = await signUpFreshCreator(browser, baseURL!, 'xorg-b');
    try {
      for (const call of setupCalls(b.projectId)) {
        const res = await send(a.page.request, origin, call);
        expect(res.status(), `${call.method} ${call.url}`).toBe(404);
      }
      // Copy from another org's project is "not found" too, never "forbidden".
      const copy = await a.page.request.post(`/api/projects/${a.projectId}/setup/copy`, { data: { sourceProjectId: b.projectId, allProviders: true }, headers: { Origin: origin } });
      expect(copy.status()).toBe(404);
      // Owner B still reads its own project: the 404 is about A, not the project.
      expect((await b.page.request.get(`/api/projects/${b.projectId}/setup`)).status()).toBe(200);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('a CLI bearer token is refused with 401 on every setup route, even next to a session @critical', async ({ browser, baseURL }) => {
    const creator = await signUpFreshCreator(browser, baseURL!, 'bearer');
    const origin = new URL(baseURL!).origin;
    const created = await creator.page.request.post('/api/cli-tokens', { data: { name: `setup-bearer-${Date.now()}` }, headers: { Origin: origin } });
    expect(created.status()).toBe(201);
    const token = ((await created.json()) as { token: { id: string; key: string } }).token;
    const signedOut = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const bearer = { Authorization: `Bearer ${token.key}` };
      for (const call of [...setupCalls(creator.projectId), { method: 'GET', url: '/api/me/preferences' }]) {
        const alone = await send(signedOut.request, origin, call, bearer);
        expect(alone.status(), `${call.method} ${call.url} (bearer only)`).toBe(401);
        expect(await alone.json()).toEqual({ error: 'Session authentication required' });
        // A valid session cookie does not make a bearer header acceptable.
        expect((await send(creator.page.request, origin, call, bearer)).status(), `${call.method} ${call.url} (bearer + cookie)`).toBe(401);
      }
      // The token itself is valid: the refusal is the setup routes' rule, not a bad credential.
      expect((await signedOut.request.get('/api/cli/project-config', { headers: bearer })).status()).toBe(200);
    } finally {
      await creator.page.request.delete(`/api/cli-tokens/${token.id}`, { headers: { Origin: origin } });
      await signedOut.close();
      await creator.context.close();
    }
  });

  test('a project admin takes over the setup lock from the owner; an editor cannot @critical', async ({ orgOwnerPage, getPageForRole }) => {
    // Role pages are opened only after their credentials are known to exist; the fixtures throw otherwise.
    test.skip(!hasRbacUser('projectAdmin'), 'E2E project admin credentials are not configured');
    const projectAdminPage = await getPageForRole(Role.ProjectAdmin);
    const editorPage = hasRbacUser('editor') ? await getPageForRole(Role.Editor) : null;
    const projectId = await currentProjectId(orgOwnerPage);
    const lockUrl = `/api/projects/${projectId}/setup/lock`;
    test.skip((await projectAdminPage.request.get(`/api/projects/${projectId}/setup`)).status() !== 200, 'Project admin is not a member of the shared project');

    const ownerToken = randomUUID();
    const adminToken = randomUUID();
    try {
      // Takeover: a lock left on the shared project by an earlier run must not fail this test.
      const held = await orgOwnerPage.request.post(lockUrl, { data: { lockToken: ownerToken, takeover: true } });
      expect(held.status()).toBe(200);
      expect((await held.json()).lock).toMatchObject({ mine: true });

      // A second user is turned away while the lock is fresh, and told who holds it.
      const refused = await projectAdminPage.request.post(lockUrl, { data: { lockToken: adminToken } });
      expect(refused.status()).toBe(423);
      expect((await refused.json()).lock).toMatchObject({ mine: false });

      if (editorPage && (await editorPage.request.get(`/api/projects/${projectId}/setup`)).status() === 200) {
        // Takeover needs project:update, so an editor can never evict the holder.
        expect((await editorPage.request.post(lockUrl, { data: { lockToken: randomUUID(), takeover: true } })).status()).toBe(403);
      }

      const taken = await projectAdminPage.request.post(lockUrl, { data: { lockToken: adminToken, takeover: true } });
      expect(taken.status()).toBe(200);
      expect((await taken.json()).lock).toMatchObject({ mine: true });

      // The owner's next heartbeat finds the lock gone instead of silently reclaiming it.
      expect((await orgOwnerPage.request.post(lockUrl, { data: { lockToken: ownerToken } })).status()).toBe(423);
      const state = await (await orgOwnerPage.request.get(`/api/projects/${projectId}/setup`)).json();
      expect(state.state.lock).toMatchObject({ mine: false });
    } finally {
      // Shared project: never leave a lock behind for other specs.
      await projectAdminPage.request.delete(lockUrl, { data: { lockToken: adminToken } });
      await orgOwnerPage.request.delete(lockUrl, { data: { lockToken: ownerToken } });
    }
  });
});
