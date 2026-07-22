import { expect, test } from '../../fixtures/roles.fixture';
import { authenticateWithApi } from '../../utils/api-auth';
import { env, requireCredentials, requireRbacUser } from '../../utils/env';

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviteLink: string;
};

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e-test.supercheck.io`;
}

async function createInvitation(
  request: import('@playwright/test').APIRequestContext,
  input: { email: string; role: string; selectedProjects: string[] },
): Promise<Invitation> {
  const response = await request.post('/api/organizations/members/invite', { data: input });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { success: boolean; data: Invitation };
  expect(body.success).toBe(true);
  expect(body.data).toMatchObject({
    id: expect.any(String),
    email: input.email.toLowerCase(),
    role: input.role,
    status: 'pending',
    expiresAt: expect.any(String),
    inviteLink: expect.stringContaining(`/invite/${body.data.id}`),
  });
  return body.data;
}

async function cancelInvitation(
  request: import('@playwright/test').APIRequestContext,
  id: string,
): Promise<void> {
  const response = await request.delete(`/api/organizations/members/invite/${id}`);
  if (response.status() === 404) return;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ success: true });
}

test.describe('Invitation lifecycle @auth @invitations', () => {
  test.beforeAll(() => requireRbacUser('orgOwner'));

  test('org owner issues a role-scoped invitation that is visible through API and public UI @high @positive', async ({
    orgOwnerPage,
    browser,
  }) => {
    const email = uniqueEmail('invite-viewer');
    const invitation = await createInvitation(orgOwnerPage.request, {
      email,
      role: 'project_viewer',
      selectedProjects: [],
    });

    try {
      const listResponse = await orgOwnerPage.request.get('/api/organizations/invitations');
      expect(listResponse.status()).toBe(200);
      const list = (await listResponse.json()) as {
        success: boolean;
        data: Array<{ id: string; email: string; role: string; status: string }>;
      };
      expect(list.success).toBe(true);
      expect(list.data).toContainEqual(
        expect.objectContaining({
          id: invitation.id,
          email,
          role: 'project_viewer',
          status: 'pending',
        }),
      );

      const publicResponse = await orgOwnerPage.request.get(`/api/invite/${invitation.id}`);
      expect(publicResponse.status()).toBe(200);
      expect(await publicResponse.json()).toMatchObject({
        success: true,
        data: {
          email,
          role: 'project_viewer',
          organizationName: expect.any(String),
          expiresAt: invitation.expiresAt,
        },
      });

      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      try {
        await page.goto(`/invite/${invitation.id}`);
        await expect(page.getByRole('heading', { name: "You're Invited!" })).toBeVisible();
        await expect(page.getByText(email, { exact: true })).toBeVisible();
        await expect(page.getByText('Project Viewer', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Accept Invitation' }).click();
        await expect(page).toHaveURL(new RegExp(`/sign-up\\?invite=${invitation.id}$`));
      } finally {
        await context.close();
      }
    } finally {
      await cancelInvitation(orgOwnerPage.request, invitation.id);
    }

    const cancelledResponse = await orgOwnerPage.request.get(`/api/invite/${invitation.id}`);
    expect(cancelledResponse.status()).toBe(400);
    expect(await cancelledResponse.json()).toEqual({
      error: 'Invitation has already been used or cancelled',
    });
  });

  test('project role invitation requires and persists an in-organization project assignment @high @rbac', async ({
    orgOwnerPage,
  }) => {
    const projectsResponse = await orgOwnerPage.request.get('/api/projects');
    expect(projectsResponse.status()).toBe(200);
    const projects = (await projectsResponse.json()) as {
      currentProject?: { id?: string } | null;
      data?: Array<{ id: string }>;
    };
    const projectId = projects.currentProject?.id ?? projects.data?.[0]?.id;
    expect(projectId).toEqual(expect.any(String));

    const missingScope = await orgOwnerPage.request.post('/api/organizations/members/invite', {
      data: { email: uniqueEmail('invite-invalid-scope'), role: 'project_editor', selectedProjects: [] },
    });
    expect(missingScope.status()).toBe(400);
    expect(await missingScope.json()).toEqual({
      error: 'At least one project must be selected for project-specific roles',
    });

    const invitation = await createInvitation(orgOwnerPage.request, {
      email: uniqueEmail('invite-editor'),
      role: 'project_editor',
      selectedProjects: [projectId as string],
    });
    await cancelInvitation(orgOwnerPage.request, invitation.id);
  });

  test('duplicate pending invitation is rejected and cancellation is idempotently cleaned up @high @negative', async ({
    orgOwnerPage,
  }) => {
    const email = uniqueEmail('invite-duplicate');
    const invitation = await createInvitation(orgOwnerPage.request, {
      email,
      role: 'project_viewer',
      selectedProjects: [],
    });

    try {
      const duplicate = await orgOwnerPage.request.post('/api/organizations/members/invite', {
        data: { email: email.toUpperCase(), role: 'project_viewer', selectedProjects: [] },
      });
      expect(duplicate.status()).toBe(400);
      expect(await duplicate.json()).toEqual({ error: 'Invitation already sent to this email' });
    } finally {
      await cancelInvitation(orgOwnerPage.request, invitation.id);
    }
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

test.describe('Invitation acceptance @auth @invitations', () => {
  test.beforeAll(() => {
    requireRbacUser('orgOwner');
    requireCredentials(
      env.inviteeUser,
      'E2E_INVITEE_EMAIL and E2E_INVITEE_PASSWORD',
    );
  });

  test('existing non-member accepts an invitation and receives the exact role @critical @positive', async ({
    orgOwnerPage,
    playwright,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required');
    const inviteeEmail = env.inviteeUser.email.toLowerCase().trim();

    const removeExistingMembership = async (): Promise<void> => {
      const membersResponse = await orgOwnerPage.request.get('/api/organizations/members');
      expect(membersResponse.status()).toBe(200);
      const membersBody = (await membersResponse.json()) as {
        data: { members: Array<{ id: string; email: string }> };
      };
      const existing = membersBody.data.members.find(
        (member) => member.email.toLowerCase() === inviteeEmail,
      );
      if (!existing) return;
      const removeResponse = await orgOwnerPage.request.delete(
        `/api/organizations/members/${existing.id}`,
      );
      expect(removeResponse.status()).toBe(200);
    };

    await removeExistingMembership();
    const invitationsResponse = await orgOwnerPage.request.get('/api/organizations/invitations');
    expect(invitationsResponse.status()).toBe(200);
    const existingInvitations = (await invitationsResponse.json()) as {
      data: Array<{ id: string; email: string; status: string }>;
    };
    for (const pending of existingInvitations.data.filter(
      (item) => item.email.toLowerCase() === inviteeEmail && item.status === 'pending',
    )) {
      await cancelInvitation(orgOwnerPage.request, pending.id);
    }

    const invitation = await createInvitation(orgOwnerPage.request, {
      email: inviteeEmail,
      role: 'project_viewer',
      selectedProjects: [],
    });

    const storageState = await authenticateWithApi(
      playwright.request,
      baseURL,
      env.inviteeUser,
      { requireProjectContext: false },
    );
    const inviteeRequest = await playwright.request.newContext({ baseURL, storageState });

    try {
      const acceptResponse = await inviteeRequest.post(`/api/invite/${invitation.id}`);
      expect(acceptResponse.status()).toBe(200);
      expect(await acceptResponse.json()).toMatchObject({
        success: true,
        data: {
          organizationName: expect.any(String),
          role: 'project_viewer',
          message: expect.stringContaining('project_viewer'),
        },
      });

      const replayResponse = await inviteeRequest.post(`/api/invite/${invitation.id}`);
      expect(replayResponse.status()).toBe(400);
      expect(await replayResponse.json()).toEqual({
        error: 'Invitation has already been used or cancelled',
      });

      const membersResponse = await orgOwnerPage.request.get('/api/organizations/members');
      expect(membersResponse.status()).toBe(200);
      const membersBody = (await membersResponse.json()) as {
        data: { members: Array<{ id: string; email: string; role: string }> };
      };
      expect(membersBody.data.members).toContainEqual(
        expect.objectContaining({ email: inviteeEmail, role: 'project_viewer' }),
      );
    } finally {
      await inviteeRequest.dispose();
      await removeExistingMembership();
    }
  });
});
