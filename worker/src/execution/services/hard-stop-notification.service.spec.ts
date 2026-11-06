import { HardStopNotificationService } from './hard-stop-notification.service';
import * as smtp from '../../common/utils/smtp-transport';

jest.mock('../../common/utils/smtp-transport', () => ({
  sendMailToRecipients: jest.fn(),
  closeSmtpTransport: jest.fn(),
}));

const send = smtp.sendMailToRecipients as jest.Mock;

function build() {
  const redis = {
    exists: jest.fn().mockResolvedValue(0),
    setex: jest.fn().mockResolvedValue('OK'),
  };
  const adminRows = [{ email: 'owner@acme.test' }];
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn(() => chain);
  chain.innerJoin = jest.fn(() => chain);
  chain.where = jest.fn().mockResolvedValue(adminRows);
  const db = {
    query: {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Acme' }),
      },
      billingSettings: { findFirst: jest.fn().mockResolvedValue(undefined) },
    },
    select: jest.fn(() => chain),
  };
  const service = new HardStopNotificationService(
    db as never,
    { getClient: () => redis } as never,
  );
  return { service, redis };
}

describe('HardStopNotificationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends through the shared transport with a [Supercheck] subject', async () => {
    send.mockResolvedValue({ sentCount: 1, failedRecipients: [], errors: {} });
    const { service, redis } = build();
    await expect(service.notify('org-1', 'run-1', 'limit')).resolves.toEqual({
      sent: true,
    });
    const [recipients, message] = send.mock.calls[0];
    expect(recipients).toEqual(['owner@acme.test']);
    expect(message.subject).toBe(
      '[Supercheck] Execution blocked: spending limit reached (Acme)',
    );
    expect(redis.setex).toHaveBeenCalled();
  });

  it('does not set the rate limit when nobody was reached', async () => {
    send.mockResolvedValue({
      sentCount: 0,
      failedRecipients: ['owner@acme.test'],
      errors: { 'owner@acme.test': 'down' },
    });
    const { service, redis } = build();
    await expect(service.notify('org-1', 'run-1', 'limit')).resolves.toEqual({
      sent: false,
    });
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('closes the shared transport on module destroy', () => {
    build().service.onModuleDestroy();
    expect(smtp.closeSmtpTransport).toHaveBeenCalledTimes(1);
  });
});
