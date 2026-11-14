import { resolveMonitorSecret, secretTransportAllowed } from './monitor-secret';
import { decryptValue } from '../common/services/variable-resolver.service';

jest.mock('../common/services/variable-resolver.service', () => ({
  decryptValue: jest.fn(),
}));

const dbReturning = (rows: unknown[]) => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'from', 'innerJoin', 'where'])
    chain[m] = jest.fn(() => chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return { db: chain as never, chain };
};

describe('resolveMonitorSecret', () => {
  beforeEach(() =>
    (decryptValue as jest.Mock).mockReset().mockReturnValue('plain'),
  );

  it('decrypts the secret with the monitor project as context, via one joined query', async () => {
    const { db, chain } = dbReturning([
      { projectId: 'p1', encryptedValue: 'enc:v1:x' },
    ]);
    await expect(resolveMonitorSecret(db, 'm1', 'KEY')).resolves.toEqual({
      ok: true,
      value: 'plain',
    });
    expect(decryptValue).toHaveBeenCalledWith('enc:v1:x', 'p1');
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.innerJoin).toHaveBeenCalledTimes(1);
  });

  it("reports a missing secret (no row, e.g. another project's key of the same name)", async () => {
    const { db } = dbReturning([]);
    await expect(resolveMonitorSecret(db, 'm1', 'KEY')).resolves.toEqual({
      ok: false,
      message: 'The project secret for this monitor was not found',
    });
    expect(decryptValue).not.toHaveBeenCalled();
  });

  it('reports a row without an encrypted value as missing', async () => {
    const { db } = dbReturning([{ projectId: 'p1', encryptedValue: null }]);
    expect(await resolveMonitorSecret(db, 'm1', 'KEY')).toMatchObject({
      ok: false,
    });
  });

  it('reports a decrypt failure without leaking details', async () => {
    (decryptValue as jest.Mock).mockImplementation(() => {
      throw new Error('bad key material');
    });
    const { db } = dbReturning([
      { projectId: 'p1', encryptedValue: 'enc:v1:x' },
    ]);
    expect(await resolveMonitorSecret(db, 'm1', 'KEY')).toEqual({
      ok: false,
      message: 'The project secret for this monitor could not be decrypted',
    });
  });

  it('drops a trailing newline and refuses a line break inside the value', async () => {
    const { db } = dbReturning([
      { projectId: 'p1', encryptedValue: 'enc:v1:x' },
    ]);
    (decryptValue as jest.Mock).mockReturnValueOnce('sk-abc\r\n');
    await expect(resolveMonitorSecret(db, 'm1', 'KEY')).resolves.toEqual({
      ok: true,
      value: 'sk-abc',
    });
    (decryptValue as jest.Mock).mockReturnValueOnce('sk\nInjected: 1');
    await expect(resolveMonitorSecret(db, 'm1', 'KEY')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('line break'),
    });
  });
});

describe('secretTransportAllowed', () => {
  afterEach(() => delete process.env.ALLOW_INTERNAL_TARGETS);
  it('allows https only, unless internal targets are allowed', () => {
    expect(secretTransportAllowed('https://api.example.com')).toBe(true);
    expect(secretTransportAllowed('http://api.example.com')).toBe(false);
    expect(secretTransportAllowed('http:api.example.com')).toBe(false);
    expect(secretTransportAllowed('not a url')).toBe(false);
    process.env.ALLOW_INTERNAL_TARGETS = 'true';
    expect(secretTransportAllowed('http://ollama.internal:11434')).toBe(true);
  });
});
