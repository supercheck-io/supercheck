import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import https from 'node:https';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({
  __esModule: true,
  default: { request: jest.fn() },
}));

import { fetchPublicEndpoint } from './pinned-public-fetch';

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;
const mockRequest = https.request as jest.MockedFunction<typeof https.request>;

describe('worker pinned public fetch', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: originalNodeEnv,
      configurable: true,
      writable: true,
    });
  });

  it('rejects private DNS answers before webhook delivery connects', async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(
      fetchPublicEndpoint('https://hooks.example.com/events'),
    ).rejects.toThrow('private or internal networks');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    '100.64.0.1',
    '192.0.0.1',
    '198.18.0.1',
    '203.0.113.1',
    '224.0.0.1',
  ])('rejects the reserved DNS answer %s', async (address) => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([{ address, family: 4 }]);

    await expect(
      fetchPublicEndpoint('https://hooks.example.com/events'),
    ).rejects.toThrow('private or internal networks');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects immediately when the HTTPS response stream errors', async () => {
    (mockLookup as jest.Mock).mockResolvedValueOnce([
      { address: '203.0.114.10', family: 4 },
    ]);
    const request = Object.assign(new EventEmitter(), {
      end: jest.fn(),
      write: jest.fn(),
      destroy: jest.fn(),
    });
    (mockRequest as unknown as jest.Mock).mockImplementation(
      (_url: URL, _options: unknown, onResponse: Function) => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          statusMessage: 'OK',
          headers: {},
        });
        onResponse(response);
        queueMicrotask(() => response.emit('error', new Error('read failed')));
        return request;
      },
    );

    await expect(
      fetchPublicEndpoint('https://hooks.example.com/events'),
    ).rejects.toThrow('read failed');
  });
});
