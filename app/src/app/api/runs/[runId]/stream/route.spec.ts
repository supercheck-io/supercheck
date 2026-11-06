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

import type { NextRequest } from 'next/server';

// The route reads its poll interval at import time, so pin it first instead of relying on the default.
const POLL_MS = 3000;
let GET: typeof import('./route').GET;
beforeAll(async () => {
  process.env.SSE_STATUS_POLL_INTERVAL_MS = String(POLL_MS);
  ({ GET } = await import('./route'));
});

async function open() {
  const request = { signal: new AbortController().signal } as unknown as NextRequest;
  const response = await GET(request, { params: Promise.resolve({ runId: RUN_ID }) });
  const reader = response.body!.getReader();
  const state = { text: '', closed: false };
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { state.closed = true; return; }
      state.text += new TextDecoder().decode(value);
    }
  })();
  return state;
}

describe('GET /api/runs/[runId]/stream', () => {
  beforeEach(() => { jest.useFakeTimers(); findFirst.mockReset(); });
  afterEach(() => jest.useRealTimers());

  it('does not emit complete while the run is still queued', async () => {
    findFirst
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValue({ status: 'passed' });
    const state = await open();
    await jest.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(state.closed).toBe(true);
    const completes = [...state.text.matchAll(/event: complete\ndata: (.*)\n/g)].map((m) => m[1]);
    expect(completes).toEqual(['{"status":"passed"}']);
  });

  it('closes a run that stays queued past the maximum lifetime, without a complete event', async () => {
    findFirst.mockResolvedValue({ status: 'queued' });
    const state = await open();
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + POLL_MS * 2);
    expect(state.closed).toBe(true);
    expect(state.text).not.toContain('event: complete');
  });

  it('keeps streaming a running run past the maximum lifetime until it completes', async () => {
    findFirst.mockResolvedValue({ status: 'running' });
    const state = await open();
    await jest.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(state.closed).toBe(false);
    findFirst.mockResolvedValue({ status: 'passed' });
    await jest.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(state.closed).toBe(true);
    expect(state.text).toContain('event: complete\ndata: {"status":"passed"}');
  });
});
