import * as nodemailer from 'nodemailer';
import {
  buildSmtpSetup,
  closeSmtpTransport,
  sendMailToRecipients,
} from './smtp-transport';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const createTransport = nodemailer.createTransport as jest.Mock;
const message = { subject: 's', html: '<p>h</p>', text: 't' };

describe('smtp-transport', () => {
  beforeEach(() => {
    closeSmtpTransport();
    createTransport.mockReset();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM_EMAIL = 'alerts@example.com';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_NAME;
    delete process.env.SMTP_REPLY_TO;
  });

  afterAll(() => {
    closeSmtpTransport();
    for (const k of ['SMTP_HOST', 'SMTP_FROM_EMAIL']) delete process.env[k];
  });

  const transport = (sendMail: jest.Mock) => ({ sendMail, close: jest.fn() });

  it('uses bounded timeouts and a pool', () => {
    const setup = buildSmtpSetup();
    expect('config' in setup && setup.config).toMatchObject({
      pool: true,
      connectionTimeout: 10000,
      greetingTimeout: 5000,
    });
  });

  it('reuses the transporter while the config is unchanged', async () => {
    createTransport.mockReturnValue(transport(jest.fn().mockResolvedValue({})));
    await sendMailToRecipients(['a@x.io'], message);
    await sendMailToRecipients(['b@x.io'], message);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('recreates the transporter (closing the old pool) when the SMTP config changes', async () => {
    const first = transport(jest.fn().mockResolvedValue({}));
    const second = transport(jest.fn().mockResolvedValue({}));
    createTransport.mockReturnValueOnce(first).mockReturnValueOnce(second);
    await sendMailToRecipients(['a@x.io'], message);
    process.env.SMTP_HOST = 'smtp2.example.com';
    await sendMailToRecipients(['a@x.io'], message);
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.sendMail).toHaveBeenCalledTimes(1);
  });

  it('closeSmtpTransport closes the pool and the next send builds a new one', async () => {
    const t = transport(jest.fn().mockResolvedValue({}));
    createTransport.mockReturnValue(t);
    await sendMailToRecipients(['a@x.io'], message);
    closeSmtpTransport();
    expect(t.close).toHaveBeenCalledTimes(1);
    await sendMailToRecipients(['a@x.io'], message);
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it('fails the remaining recipients fast after a connection error', async () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    const sendMail = jest.fn().mockRejectedValue(err);
    createTransport.mockReturnValue(transport(sendMail));
    const r = await sendMailToRecipients(
      ['a@x.io', 'b@x.io', 'c@x.io'],
      message,
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(r.sentCount).toBe(0);
    expect(r.failedRecipients).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(r.errors['c@x.io']).toBe('connect ETIMEDOUT');
  });

  it('never hands reserved or blocked domains to SMTP', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReturnValue(transport(sendMail));
    process.env.SMTP_BLOCKED_RECIPIENT_DOMAINS = 'blocked.io';
    const warn = jest.fn();
    const r = await sendMailToRecipients(
      ['a@x.io', 'b@example.com', 'c@e2e.invalid', 'd@sub.blocked.io'],
      message,
      warn,
    );
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual(['a@x.io']);
    expect(r).toEqual({ sentCount: 1, failedRecipients: [], errors: {} });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped 3'));
    sendMail.mockClear();
    expect(await sendMailToRecipients(['z@example.org'], message)).toEqual({
      sentCount: 0,
      failedRecipients: [],
      errors: {},
    });
    expect(sendMail).not.toHaveBeenCalled();
    delete process.env.SMTP_BLOCKED_RECIPIENT_DOMAINS;
  });

  it('keeps going after a per-recipient rejection', async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('rejected'), { code: 'EENVELOPE' }),
      )
      .mockResolvedValueOnce({});
    createTransport.mockReturnValue(transport(sendMail));
    const r = await sendMailToRecipients(['a@x.io', 'b@x.io'], message);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ sentCount: 1, failedRecipients: ['a@x.io'] });
  });

  it('applies the From display name and Reply-To only when configured', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReturnValue(transport(sendMail));
    await sendMailToRecipients(['a@x.io'], message);
    expect(sendMail.mock.calls[0][0].from).toBe('alerts@example.com');
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('replyTo');
    process.env.SMTP_FROM_NAME = 'Acme';
    process.env.SMTP_REPLY_TO = 'help@acme.test';
    await sendMailToRecipients(['a@x.io'], message);
    expect(sendMail.mock.calls[1][0]).toMatchObject({
      from: { name: 'Acme', address: 'alerts@example.com' },
      replyTo: 'help@acme.test',
    });
  });

  it('returns a configuration error for every recipient without creating a transport', async () => {
    delete process.env.SMTP_HOST;
    const r = await sendMailToRecipients(['a@x.io', 'b@x.io'], message);
    expect(createTransport).not.toHaveBeenCalled();
    expect(r.sentCount).toBe(0);
    expect(r.errors['b@x.io']).toMatch(/missing SMTP_HOST/);
  });
});
