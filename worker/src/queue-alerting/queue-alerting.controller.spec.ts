import { QueueAlertingController } from './queue-alerting.controller';
import type { QueueAlertingService } from './queue-alerting.service';

describe('QueueAlertingController.getConfig', () => {
  it('redacts webhook URLs', () => {
    const service = {
      getConfig: () => ({
        enabled: true,
        slackWebhookUrl: 'https://hooks.slack.com/services/T/B/secret',
        alertWebhookUrl: 'https://example.com/hook?token=secret',
      }),
    } as unknown as QueueAlertingService;
    const config = new QueueAlertingController(service).getConfig();
    expect(JSON.stringify(config)).not.toContain('secret');
    expect(config).toMatchObject({
      enabled: true,
      slackWebhookUrl: '[redacted]',
      alertWebhookUrl: '[redacted]',
    });
  });
});
