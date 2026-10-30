import { isValidTeamsWebhookDomain } from './notification.constants';

// Keep in sync with the app's validation.spec.ts (same URL shapes, save-time check).
describe('Teams webhook domain allowlist', () => {
  it.each([
    [
      'https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x',
      true,
    ],
    [
      'https://abc.12.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x/triggers/manual/paths/invoke?sig=x',
      true,
    ],
    ['https://contoso.webhook.office.com/webhookb2/abc', true],
    ['https://outlook.office.com/webhook/abc', false],
    ['https://evil.azurewebsites.net/hook', false],
    ['https://evilpowerplatform.com/hook', false],
  ])('%s -> %s', (url, ok) => {
    expect(isValidTeamsWebhookDomain(new URL(url).hostname)).toBe(ok);
  });
});
