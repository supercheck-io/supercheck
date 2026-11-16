import { EventEmitter } from 'events';

const connect = jest.fn();
jest.mock('tls', () => ({
  connect: (...args: unknown[]) => connect(...args),
}));

import { readCertificate } from './tls-certificate';

const lookup = jest.fn() as never;
// Like Node: once destroy() runs the handle is gone and getPeerCertificate() returns null.
const fakeSocket = (cert: unknown = {}) => {
  let destroyed = false;
  return Object.assign(new EventEmitter(), {
    destroy: jest.fn(() => {
      destroyed = true;
    }),
    getPeerCertificate: jest.fn(() => (destroyed ? null : cert)),
  });
};
const opts = { hostname: 'a.test', port: 443, lookup, timeoutMs: 1000 };

describe('readCertificate', () => {
  beforeEach(() => connect.mockReset());

  it('verifies the certificate and reports expiry and issuer', async () => {
    const validTo = new Date(Date.now() + 3 * 86_400_000);
    const socket = fakeSocket({
      valid_to: validTo.toUTCString(),
      issuer: { CN: 'CA' },
    });
    connect.mockImplementation((_o, cb) => {
      setImmediate(() => cb());
      return socket;
    });
    const info = await readCertificate(opts);
    const o = connect.mock.calls[0][0];
    expect(o).toMatchObject({ host: 'a.test', servername: 'a.test', lookup });
    expect(o.rejectUnauthorized).toBeUndefined();
    expect(info).toMatchObject({ issuer: 'CA', daysRemaining: 3 });
    expect(socket.destroy).toHaveBeenCalled();
    // The certificate is read before the socket is closed.
    expect(socket.getPeerCertificate.mock.invocationCallOrder[0]).toBeLessThan(
      socket.destroy.mock.invocationCallOrder[0],
    );
  });

  it('returns the verification error code without a date', async () => {
    const socket = fakeSocket();
    connect.mockImplementation(() => {
      setImmediate(() =>
        socket.emit(
          'error',
          Object.assign(new Error('expired'), { code: 'CERT_HAS_EXPIRED' }),
        ),
      );
      return socket;
    });
    await expect(readCertificate(opts)).resolves.toEqual({
      invalid: true,
      reason: 'CERT_HAS_EXPIRED',
    });
  });

  it('rejects other errors, a missing expiry and timeouts', async () => {
    const failing = fakeSocket();
    connect.mockImplementation(() => {
      setImmediate(() => failing.emit('error', new Error('refused')));
      return failing;
    });
    await expect(readCertificate(opts)).rejects.toThrow('refused');

    connect.mockImplementation((_o, cb) => {
      setImmediate(() => cb());
      return fakeSocket({});
    });
    await expect(readCertificate(opts)).rejects.toThrow('no expiry');

    connect.mockImplementation(() => fakeSocket());
    await expect(readCertificate({ ...opts, timeoutMs: 5 })).rejects.toThrow(
      'timeout after 5ms',
    );
  });
});
