/**
 * @jest-environment node
 */
const mockSend = jest.fn();
const mockDestroy = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend, destroy: mockDestroy })),
  HeadBucketCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('@/utils/db', () => ({ db: { execute: jest.fn().mockResolvedValue([]) } }));
jest.mock('drizzle-orm', () => ({ sql: jest.fn() }));

import { GET } from './route';

const unsetEnv = (key: string) => {
  delete (process.env as Record<string, string | undefined>)[key];
};

describe('GET /api/health S3 check', () => {
  const env = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, S3_ENDPOINT: 'http://s3:9000' };
    unsetEnv('REDIS_HOST');
  });

  afterAll(() => {
    process.env = env;
  });

  it('is ok when HeadBucket succeeds', async () => {
    mockSend.mockResolvedValue({});
    const body = await (await GET()).json();
    expect(body.checks.s3.status).toBe('ok');
    expect(body.status).toBe('ok');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('is ok when the bucket does not exist yet but the backend answers', async () => {
    mockSend.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const body = await (await GET()).json();
    expect(body.checks.s3.status).toBe('ok');
  });

  it('degrades when credentials are rejected', async () => {
    mockSend.mockRejectedValue({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } });
    const body = await (await GET()).json();
    expect(body.checks.s3.status).toBe('error');
    expect(body.status).toBe('degraded');
  });

  it('degrades when the endpoint is unreachable', async () => {
    mockSend.mockRejectedValue(new Error('getaddrinfo ENOTFOUND s3'));
    const body = await (await GET()).json();
    expect(body.checks.s3.status).toBe('error');
    expect(body.status).toBe('degraded');
  });

  it('skips the check when S3_ENDPOINT is unset', async () => {
    unsetEnv('S3_ENDPOINT');
    const body = await (await GET()).json();
    expect(body.checks.s3).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
