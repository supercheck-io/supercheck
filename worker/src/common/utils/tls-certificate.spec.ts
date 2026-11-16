import { EventEmitter } from 'events';

const connect = jest.fn();
jest.mock('tls', () => ({ connect: (...args: unknown[]) => connect(...args) }));

import { readPeerCertificate } from './tls-certificate';

const lookup = jest.fn();

function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    destroy: jest.fn(),
    authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    getPeerCertificate: jest.fn().mockReturnValue({ valid_to: 'x' }),
  });
  return socket;
}

describe('readPeerCertificate', () => {
  beforeEach(() => connect.mockReset());

  it('dials through the supplied lookup and returns the certificate even when unauthorized', async () => {
    const socket = fakeSocket();
    connect.mockImplementation((_opts, onSecure: () => void) => {
      setImmediate(onSecure);
      return socket;
    });
    const info = await readPeerCertificate({
      hostname: 'a.test',
      port: 443,
      lookup,
      timeoutMs: 1000,
    });
    expect(connect.mock.calls[0][0]).toMatchObject({
      host: 'a.test',
      servername: 'a.test',
      port: 443,
      lookup,
      rejectUnauthorized: false,
    });
    expect(info).toMatchObject({
      certificate: { valid_to: 'x' },
      authorized: false,
    });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects on socket error and on timeout', async () => {
    const failing = fakeSocket();
    connect.mockImplementation(() => {
      setImmediate(() => failing.emit('error', new Error('refused')));
      return failing;
    });
    await expect(
      readPeerCertificate({
        hostname: 'a.test',
        port: 443,
        lookup,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('refused');

    connect.mockImplementation(() => fakeSocket());
    await expect(
      readPeerCertificate({
        hostname: 'a.test',
        port: 443,
        lookup,
        timeoutMs: 5,
      }),
    ).rejects.toThrow('SSL connection timeout after 5ms');
  });
});
