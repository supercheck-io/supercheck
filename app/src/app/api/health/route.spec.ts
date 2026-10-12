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


const { S3Client: S3ClientMock, HeadBucketCommand: HeadBucketMock } = jest.requireMock('@aws-sdk/client-s3');

const unsetEnv = (key: string) => {
  delete (process.env as Record<string, string | undefined>)[key];
};

// The route caches the S3 result at module level, so load a fresh copy per call.
const loadGet = async () => {
  let GET!: () => Promise<Response>;
  await jest.isolateModulesAsync(async () => {
    ({ GET } = await import('./route'));
  });
  return GET;
};
const call = async () => (await (await loadGet())()).json();

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
    const body = await call();
    expect(body.checks.s3.status).toBe('ok');
    expect(body.status).toBe('ok');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('is ok when the bucket does not exist yet but the backend answers', async () => {
    mockSend.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404, requestId: 'abc' } });
    const body = await call();
    expect(body.checks.s3.status).toBe('ok');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('accepts NoSuchBucket', async () => {
    mockSend.mockRejectedValue({ name: 'NoSuchBucket', $metadata: { requestId: 'abc' } });
    expect((await call()).checks.s3.status).toBe('ok');
  });

  it('does not treat a bodiless 404 without an S3 request id as healthy', async () => {
    mockSend.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const body = await call();
    expect(body.checks.s3.status).toBe('error');
  });

  it('degrades on 501 and reports name and status only', async () => {
    mockSend.mockRejectedValue({ name: 'NotImplemented', message: 'secret-host:9000', $metadata: { httpStatusCode: 501 } });
    const body = await call();
    expect(body.status).toBe('degraded');
    expect(body.checks.s3.error).toBe('S3 probe failed: NotImplemented (501)');
    expect(body.checks.s3.error).not.toContain('secret-host');
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('degrades on timeout and a thrown non-object', async () => {
    mockSend.mockRejectedValueOnce({ name: 'TimeoutError' });
    expect((await call()).checks.s3.error).toBe('S3 probe failed: TimeoutError');
    mockSend.mockRejectedValueOnce(null);
    expect((await call()).checks.s3.status).toBe('error');
  });

  it('configures the client and bucket from env, with a timeout signal', async () => {
    process.env.S3_TEST_BUCKET_NAME = 'custom-bucket';
    process.env.AWS_ACCESS_KEY_ID = 'ak';
    process.env.AWS_SECRET_ACCESS_KEY = 'sk';
    mockSend.mockResolvedValue({});
    await (await loadGet())();
    expect(S3ClientMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'http://s3:9000',
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
    }));
    expect(HeadBucketMock).toHaveBeenCalledWith({ Bucket: 'custom-bucket' });
    expect(mockSend.mock.calls[0][1]).toEqual({ abortSignal: expect.any(AbortSignal) });
  });

  it('degrades when credentials are rejected', async () => {
    mockSend.mockRejectedValue({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } });
    const body = await call();
    expect(body.checks.s3.status).toBe('error');
    expect(body.status).toBe('degraded');
  });

  it('degrades when the endpoint is unreachable', async () => {
    mockSend.mockRejectedValue(new Error('getaddrinfo ENOTFOUND s3'));
    const body = await call();
    expect(body.checks.s3.status).toBe('error');
    expect(body.status).toBe('degraded');
  });

  it('skips the check when S3_ENDPOINT is unset', async () => {
    unsetEnv('S3_ENDPOINT');
    const body = await call();
    expect(body.checks.s3).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('shares one probe across concurrent requests and caches the result', async () => {
    mockSend.mockResolvedValue({});
    const get = await loadGet();
    await Promise.all([get(), get(), get()]);
    await get();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('reports a fixed message, and caches it, when the client cannot be built', async () => {
    (S3ClientMock as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad endpoint http://secret-host');
    });
    const get = await loadGet();
    const body = await (await get()).json();
    expect(body.checks.s3.error).toBe('S3 connection failed');
    await get();
    expect(S3ClientMock).toHaveBeenCalledTimes(1);
  });

  it('omits latencyMs on cache hits', async () => {
    mockSend.mockResolvedValue({});
    const get = await loadGet();
    expect((await (await get()).json()).checks.s3.latencyMs).toEqual(expect.any(Number));
    expect((await (await get()).json()).checks.s3.latencyMs).toBeUndefined();
  });

  it('degrades on a 403 even when it carries an S3 request id', async () => {
    mockSend.mockRejectedValue({ name: 'Forbidden', $metadata: { httpStatusCode: 403, requestId: 'abc' } });
    const body = await call();
    expect(body.checks.s3.error).toBe('S3 probe failed: Forbidden (403)');
    expect(body.status).toBe('degraded');
  });

  it('re-probes when the bucket or credentials change within the TTL', async () => {
    mockSend.mockResolvedValue({});
    const get = await loadGet();
    await get();
    process.env.S3_TEST_BUCKET_NAME = 'other-bucket';
    await get();
    process.env.AWS_ACCESS_KEY_ID = 'other-key';
    await get();
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});
