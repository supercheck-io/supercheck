import { expect, test } from '@playwright/test';

import { captureFixturePage } from '../../fixtures/checkpoint.fixture';
import { waitForHydration } from '../../utils/hydration';
import { chooseProfile, goToStep, purgeCreatedItems, SIGN_UP_GATED, signUpFreshCreator, wizard, type FreshCreator } from '../../utils/setup-test-data';

type Provider = { id: string; name: string; type: string };

test.describe('Project setup copy from project @setup', SIGN_UP_GATED, () => {
  let creator: FreshCreator | undefined;
  let source: { id: string; name: string } | undefined;
  let sourceChannelId: string | undefined;

  test.afterEach(async () => {
    if (creator && test.info().status !== test.info().expectedStatus) await captureFixturePage(creator.page, 'creatorPage');
  });

  test.afterAll(async ({ baseURL }) => {
    if (!creator) return;
    const { request } = creator.page;
    const headers = { Origin: new URL(baseURL!).origin };
    try {
      await purgeCreatedItems(request);
      // The second project and its channel are outside the purge, which covers the current project only.
      if (source && sourceChannelId) {
        const res = await request.delete(`/api/notification-providers/${sourceChannelId}`, { headers: { ...headers, 'x-project-id': source.id } });
        expect([200, 204, 404]).toContain(res.status());
      }
      if (source) expect([200, 404]).toContain((await request.delete(`/api/projects/${source.id}`, { headers })).status());
    } finally {
      await creator.context.close();
    }
  });

  test('copies an email channel from a second project into setup, then adopts it on a repeat @critical', async ({ browser, baseURL }) => {
    creator = await signUpFreshCreator(browser, baseURL!, 'copy');
    const { page } = creator;
    const target = creator.projectId;
    const origin = new URL(baseURL!).origin;

    // A second project in the same organization, with one email channel to copy from.
    const created = await page.request.post('/api/projects', { data: { name: `Copy source ${Date.now()}` }, headers: { Origin: origin } });
    expect(created.status(), await created.text()).toBe(201);
    source = ((await created.json()) as { data: { id: string; name: string } }).data;
    const channelName = `Ops email ${Date.now()}`;
    const channel = await page.request.post('/api/notification-providers', {
      headers: { 'x-project-id': source.id, Origin: origin },
      data: { type: 'email', config: { name: channelName, emails: 'ops@example.com' } },
    });
    expect(channel.ok(), await channel.text()).toBe(true);
    sourceChannelId = ((await channel.json()) as { id: string }).id;

    // Load setup again so the project switcher knows the new project.
    await page.goto(`/setup?project=${target}`);
    await waitForHydration(page);
    await chooseProfile(page, 'SRE and platform');
    await goToStep(page, 'alerts');

    const copy = wizard(page).getByTestId('setup-copy-providers');
    await expect(copy).toBeVisible();
    await copy.getByRole('combobox').click();
    await page.getByRole('option', { name: source.name }).click();
    await copy.getByRole('button', { name: `Copy all alert channels from ${source.name}` }).click();

    const results = copy.getByRole('list', { name: 'Copy results' });
    await expect(results.getByRole('listitem').filter({ hasText: channelName })).toContainText('Copied');

    const inTarget = async () =>
      ((await (await page.request.get('/api/notification-providers', { headers: { 'x-project-id': target } })).json()) as Provider[] | { data?: Provider[] });
    const list = (body: Awaited<ReturnType<typeof inTarget>>) => (Array.isArray(body) ? body : (body.data ?? []));
    const copied = list(await inTarget()).filter((p) => p.name === channelName);
    expect(copied).toHaveLength(1);
    expect(copied[0].type).toBe('email');

    // A second copy finds the same channel and adopts it instead of duplicating.
    await copy.getByRole('button', { name: `Copy all alert channels from ${source.name}` }).click();
    await expect(results.getByRole('listitem').filter({ hasText: channelName })).toContainText('Already there');
    expect(list(await inTarget()).filter((p) => p.name === channelName)).toHaveLength(1);

    // The source keeps its channel.
    const inSource = await (await page.request.get('/api/notification-providers', { headers: { 'x-project-id': source.id } })).json();
    expect(list(inSource).filter((p) => p.name === channelName)).toHaveLength(1);
  });
});
