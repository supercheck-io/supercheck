/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

jest.mock('@/utils/db', () => ({ db: { select: jest.fn(), query: { monitors: { findFirst: jest.fn() } } } }));
jest.mock('@/lib/auth-context', () => ({ requireAuthContext: jest.fn(), isAuthError: () => false }));
jest.mock('@/lib/rbac/middleware', () => ({
  requireAuth: jest.fn(), hasPermissionForUser: jest.fn(), checkPermissionWithContext: jest.fn(),
}));
jest.mock('@/components/monitors/monitor-detail-client', () => ({
  MonitorDetailClient: ({ monitor }: { monitor: unknown }) => <pre>{JSON.stringify(monitor)}</pre>,
}));
jest.mock('@/components/page-breadcrumbs', () => ({ PageBreadcrumbs: () => null }));
jest.mock('@/lib/monitor-service', () => ({}));
jest.mock('@/lib/monitor-scheduler', () => ({}));
jest.mock('@/lib/audit-logger', () => ({ logAuditEvent: jest.fn() }));
jest.mock('@/lib/middleware/plan-enforcement', () => ({}));
jest.mock('@/lib/middleware/plan-limit-lock', () => ({}));
jest.mock('@/lib/services/subscription-service', () => ({}));
jest.mock('@/lib/location-registry', () => ({}));
jest.mock('@/lib/s3-cleanup', () => ({}));
jest.mock('@/lib/logger/index', () => ({ createLogger: () => ({ error: jest.fn(), debug: jest.fn() }) }));

import { db } from '@/utils/db';
import { monitors, monitorResults } from '@/db/schema';
import { requireAuthContext } from '@/lib/auth-context';
import { requireAuth, hasPermissionForUser, checkPermissionWithContext } from '@/lib/rbac/middleware';
import { GET as list } from '@/app/api/monitors/route';
import { GET as detail } from '@/app/api/monitors/[id]/route';
import { GET as results } from '@/app/api/monitors/[id]/results/route';
import MainPage from '@/app/(main)/monitors/[id]/page';
import NotificationPage from '@/app/(notification)/notification-monitor/[id]/page';

const stored = {
  id: '5a4ace5e-24bb-5359-8883-a64501912226', name: 'Example', type: 'website', target: 'https://deploy:private-pass@example.com/health?api_key=private-apikey&page=2',
  projectId: 'project-1', organizationId: 'org-1', status: 'up',
  createdAt: null, updatedAt: null, description: null, createdByUserId: null,
  frequencyMinutes: 5, enabled: true, alertConfig: null, lastCheckAt: null,
  lastStatusChangeAt: null, mutedUntil: null, scheduledJobId: null,
  config: { method: 'POST', auth: { type: 'bearer', token: 'private-token' }, headers: { 'X-Key': 'private-key' }, body: 'private-body' },
} satisfies typeof monitors.$inferSelect;
const storedResult = {
  id: 'result-1', monitorId: '5a4ace5e-24bb-5359-8883-a64501912226', checkedAt: new Date('2026-01-01T00:00:00Z'), status: 'up', isUp: true,
  isStatusChange: false, responseTimeMs: 12, location: 'eu-central', testExecutionId: null, testReportS3Url: null,
  details: { statusCode: 200, responseHeaders: { 'content-type': 'text/html', 'set-cookie': 'sid=private-session' } },
};
const scope = { params: Promise.resolve({ id: stored.id }) };
let editable = false;
let accessible = true;

beforeEach(() => {
  jest.clearAllMocks(); editable = false; accessible = true;
  jest.mocked(requireAuth).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof requireAuth>>);
  jest.mocked(requireAuthContext).mockResolvedValue({ userId: 'user-1', organizationId: 'org-1', project: { id: 'project-1', userRole: 'project_viewer' } } as Awaited<ReturnType<typeof requireAuthContext>>);
  jest.mocked(checkPermissionWithContext).mockImplementation((_resource, action) => action === 'view' ? accessible : editable);
  jest.mocked(hasPermissionForUser).mockImplementation(async (_user, _resource, action, context) =>
    context?.projectId === stored.projectId && context?.organizationId === stored.organizationId && (action === 'view' ? accessible : editable));
  jest.mocked(db.query.monitors.findFirst).mockResolvedValue(stored);
  jest.mocked(db.select).mockImplementation((selection?: unknown) => {
    let rows: unknown[] = [];
    const builder = {
      from: (table: unknown) => { rows = table === monitors ? [stored] : table === monitorResults ? [storedResult] : []; return builder; },
      leftJoin: () => builder, where: () => builder, orderBy: () => builder,
      limit: () => builder, offset: () => builder,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(selection && 'count' in (selection as object) ? [{ count: 1 }] : rows)),
    };
    return builder as unknown as ReturnType<typeof db.select>;
  });
});

const readers = {
  list: async () => JSON.stringify(await (await list(new Request('http://localhost/api/monitors'))).json()),
  paginatedList: async () => JSON.stringify(await (await list(new Request('http://localhost/api/monitors?page=1'))).json()),
  detail: async () => JSON.stringify(await (await detail(new NextRequest('http://localhost/api/monitors/5a4ace5e-24bb-5359-8883-a64501912226'), scope)).json()),
  mainPage: async () => renderToStaticMarkup(await MainPage(scope)),
  notificationPage: async () => renderToStaticMarkup(await NotificationPage(scope)),
};

it.each(Object.entries(readers))('%s hides credentials and URL secrets from viewers and preserves editor payloads', async (_name, read) => {
  const visible = await read();
  expect(visible).toContain('POST');
  for (const secret of ['private-token', 'private-key', 'private-body', 'private-pass', 'private-apikey']) {
    expect(visible).not.toContain(secret);
  }
  expect(visible).toContain('example.com/health');
  editable = true;
  const editorView = await read();
  for (const secret of ['private-token', 'private-pass', 'private-apikey']) expect(editorView).toContain(secret);
  expect(stored.config.auth.token).toBe('private-token');
});

it('notification links check the resource project rather than the active project', async () => {
  await readers.notificationPage();
  expect(hasPermissionForUser).toHaveBeenCalledWith('user-1', 'monitor', 'view', { organizationId: 'org-1', projectId: 'project-1' });
});

it('does not serialize an inaccessible notification monitor', async () => {
  accessible = false;
  expect(await readers.notificationPage()).not.toContain('example.com');
});

it('redacts session headers from stored result details while keeping the response shape', async () => {
  const body = JSON.stringify(await (await results(new NextRequest('http://localhost/api/monitors/5a4ace5e-24bb-5359-8883-a64501912226/results'), scope)).json());
  expect(body).not.toContain('private-session');
  expect(body).toContain('[REDACTED]');
  expect(body).toContain('text/html');
  expect(storedResult.details.responseHeaders['set-cookie']).toBe('sid=private-session');
});

it.each(['detail', 'mainPage', 'notificationPage'] as const)('%s redacts session headers from recent results', async (name) => {
  const output = await readers[name]();
  expect(output).toContain('result-1');
  expect(output).not.toContain('private-session');
});
