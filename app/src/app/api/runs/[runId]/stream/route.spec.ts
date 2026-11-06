/** @jest-environment node */
const RUN_ID = '019a0000-0000-7000-8000-000000000001';

const findFirst = jest.fn();
const subscriber = {
  status: 'ready',
  setMaxListeners: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/utils/db', () => ({
  db: {
    select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => [{ id: RUN_ID }] }) }) }) }),
    query: { runs: { findFirst: (...args: unknown[]) => findFirst(...args) } },
  },
}));
jest.mock('@/lib/auth-context', () => ({
  requireAuthContext: async () => ({ project: { id: 'project' } }),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock('@/lib/rbac/middleware', () => ({ checkPermissionWithContext: () => true }));
jest.mock('@/lib/queue', () => ({
  getRedisConnection: async () => ({ duplicate: () => subscriber }),
  buildRedisOptions: () => ({}),
}));
jest.mock('@/lib/logger/index', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { GET } from './route';
import type { NextRequest } from 'next/server';

describe('GET /api/runs/[runId]/stream', () => {
  it('does not emit complete while the run is still queued', async () => {
    jest.useFakeTimers();
    findFirst
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValue({ status: 'passed' });

    const request = { signal: new AbortController().signal } as unknown as NextRequest;
    const response = await GET(request, { params: Promise.resolve({ runId: RUN_ID }) });
    const reader = response.body!.getReader();
    let text = '';
    const drain = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    })();
    await jest.advanceTimersByTimeAsync(10_000);
    await drain;
    jest.useRealTimers();

    const completes = [...text.matchAll(/event: complete\ndata: (.*)\n/g)].map((m) => m[1]);
    expect(completes).toEqual(['{"status":"passed"}']);
  });

  it('closes the stream after the maximum lifetime when the run never leaves queued', async () => {
    jest.useFakeTimers();
    findFirst.mockReset();
    findFirst.mockResolvedValue({ status: 'queued' });

    const request = { signal: new AbortController().signal } as unknown as NextRequest;
    const response = await GET(request, { params: Promise.resolve({ runId: RUN_ID }) });
    const reader = response.body!.getReader();
    let text = '';
    const drain = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += new TextDecoder().decode(value);
      }
    })();
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 1000);
    await drain; // resolves only if the server closed the stream
    jest.useRealTimers();

    expect(text).not.toContain('event: complete');
  });
});
