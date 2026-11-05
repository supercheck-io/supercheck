import {
  clearRecipientMxCache,
  partitionRecipients,
} from './email-recipient-policy';

const mockResolveMx = jest.fn();
jest.mock('node:dns/promises', () => ({
  Resolver: jest.fn().mockImplementation(() => ({
    resolveMx: (domain: string) => mockResolveMx(domain),
  })),
}));

describe('worker partitionRecipients', () => {
  beforeEach(() => clearRecipientMxCache());

  it('skips reserved domains and domains without MX, keeps the rest', async () => {
    mockResolveMx.mockImplementation((domain: string) =>
      domain === 'gmail.com'
        ? Promise.resolve([{ exchange: 'mx.google.com', priority: 5 }])
        : Promise.reject(
            Object.assign(new Error('nodata'), { code: 'ENODATA' }),
          ),
    );
    await expect(
      partitionRecipients([
        'a@gmail.com',
        'b@supercheck.dev',
        'c@x.example.com',
      ]),
    ).resolves.toEqual({
      deliverable: ['a@gmail.com'],
      skipped: ['b@supercheck.dev', 'c@x.example.com'],
    });
  });
});
