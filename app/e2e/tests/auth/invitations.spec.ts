import { expect, test } from '../../fixtures/roles.fixture';
import { requireRbacUser } from '../../utils/env';

// Only checks that never create an invitation: every created invitation sends a real email.
test.describe('Invitation validation @auth @invitations', () => {
  test.beforeAll(() => requireRbacUser('orgOwner'));

  test('project role invitation requires an in-organization project assignment @high @rbac', async ({
    orgOwnerPage,
  }) => {
    const missingScope = await orgOwnerPage.request.post('/api/organizations/members/invite', {
      data: { email: 'invite-invalid-scope@e2e-test.invalid', role: 'project_editor', selectedProjects: [] },
    });
    expect(missingScope.status()).toBe(400);
    expect(await missingScope.json()).toEqual({
      error: 'At least one project must be selected for project-specific roles',
    });
  });
});

test.describe('Invitation public authorization @auth @invitations @security', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unknown invitation returns exact not-found contracts in API and UI @high @negative', async ({
    request,
    page,
  }) => {
    const token = '00000000-0000-4000-8000-000000000001';
    const response = await request.get(`/api/invite/${token}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: 'Invitation not found' });

    await page.goto(`/invite/${token}`);
    await expect(page.getByRole('heading', { name: 'Invalid Invitation' })).toBeVisible();
    await expect(page.getByText('Invitation not found', { exact: true })).toBeVisible();
  });

  test('accepting an invitation requires authentication @high @security', async ({ request }) => {
    const response = await request.post('/api/invite/00000000-0000-4000-8000-000000000001');
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Please sign in first to accept the invitation',
    });
  });

  test('invitation management endpoints require authentication @high @security', async ({ request }) => {
    const listResponse = await request.get('/api/organizations/invitations');
    expect(listResponse.status()).toBe(401);
    expect(await listResponse.json()).toMatchObject({ error: expect.any(String) });

    const createResponse = await request.post('/api/organizations/members/invite', { data: {} });
    expect(createResponse.status()).toBe(401);
    expect(await createResponse.json()).toMatchObject({ error: expect.any(String) });
  });
});
