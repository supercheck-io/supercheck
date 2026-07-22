import { APIRequestContext } from '@playwright/test';

/**
 * Seeding utilities for E2E tests
 */

type TestDataOverrides = Record<string, unknown>;

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function responseFailure(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<string> {
  return `${response.status()} ${await response.text()}`;
}

async function expectCleanupSuccess(
  response: Awaited<ReturnType<APIRequestContext['delete']>>,
  resource: string,
): Promise<void> {
  if (response.ok() || response.status() === 404) {
    return;
  }

  throw new Error(`Failed to clean up ${resource}: ${await responseFailure(response)}`);
}

async function getProjectHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.get('/api/projects');
  if (!response.ok()) {
    throw new Error(`Failed to resolve E2E project context: ${await responseFailure(response)}`);
  }

  const body = (await response.json()) as {
    currentProject?: { id?: unknown } | null;
    data?: Array<{ id?: unknown }>;
  };
  const id = body.currentProject?.id ?? body.data?.[0]?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('E2E account has no active project; provision an isolated test project first');
  }

  return { 'x-project-id': id };
}
/**
 * Create a new test via API
 */
export async function createTest(request: APIRequestContext, overrides: TestDataOverrides = {}): Promise<{ id: string; title: string }> {
  const title = typeof overrides.title === 'string' ? overrides.title : uniqueName('E2E Seed Test');
  const headers = await getProjectHeaders(request);

  const createRes = await request.post('/api/tests', {
    headers,
    data: {
      title,
      description: 'Created automatically by E2E test suite',
      type: 'custom',
      priority: 'medium',
      script: 'console.log("hello world");',
      ...overrides,
    }
  });

  if (!createRes.ok()) {
    throw new Error(`Failed to create test: ${await responseFailure(createRes)}`);
  }

  const createData = await createRes.json();
  const testId = createData.test?.id || createData.id;
  if (typeof testId !== 'string' || !testId) {
    throw new Error('Failed to create test: response did not include an ID');
  }
  return { id: testId, title };
}

export async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  if (!testId) return;
  await expectCleanupSuccess(await request.delete(`/api/tests/${testId}`), `test ${testId}`);
}

/**
 * Create a new monitor via API
 */
export async function createMonitor(request: APIRequestContext, overrides: TestDataOverrides = {}): Promise<{ id: string; name: string }> {
  const name = typeof overrides.name === 'string' ? overrides.name : uniqueName('E2E Seed Monitor');
  const headers = await getProjectHeaders(request);
  const createRes = await request.post('/api/monitors', {
    headers,
    data: {
      name,
      type: 'http_request',
      target: 'https://example.com/',
      frequencyMinutes: 5,
      ...overrides,
    }
  });

  if (!createRes.ok()) {
    throw new Error(`Failed to create monitor: ${await responseFailure(createRes)}`);
  }

  const createData = await createRes.json();
  const monitorId = createData.id || createData.monitor?.id;
  if (typeof monitorId !== 'string' || !monitorId) {
    throw new Error('Failed to create monitor: response did not include an ID');
  }
  return { id: monitorId, name };
}

export async function deleteMonitor(request: APIRequestContext, monitorId: string): Promise<void> {
  if (!monitorId) return;
  const headers = await getProjectHeaders(request);
  await expectCleanupSuccess(
    await request.delete(`/api/monitors/${monitorId}`, { headers }),
    `monitor ${monitorId}`,
  );
}

/**
 * Create a new job via API
 */
export async function createJob(request: APIRequestContext, overrides: TestDataOverrides = {}): Promise<{ id: string; name: string; createdTestId?: string }> {
  let testId = overrides.testId;
  let testCreated = false;
  if (!testId) {
    const newTest = await createTest(request);
    testId = newTest.id;
    testCreated = true;
  }

  if (typeof testId !== 'string') {
    throw new Error('Failed to create job: test ID is not a string');
  }

  const name = typeof overrides.name === 'string' ? overrides.name : uniqueName('E2E Seed Job');
  const headers = await getProjectHeaders(request);
  const createRes = await request.post('/api/jobs', {
    headers,
    data: {
      name,
      tests: [{ id: testId }],
      ...overrides,
    }
  });


  if (!createRes.ok()) {
    if (testCreated) {
      await deleteTest(request, testId);
    }
    throw new Error(`Failed to create job: ${await responseFailure(createRes)}`);
  }

  const createData = await createRes.json();
  const jobId = createData.job?.id || createData.id;
  if (typeof jobId !== 'string' || !jobId) {
    throw new Error('Failed to create job: response did not include an ID');
  }
  return { id: jobId, name, createdTestId: testCreated ? testId : undefined };
}

export async function deleteJob(request: APIRequestContext, jobId: string): Promise<void> {
  if (!jobId) return;
  await expectCleanupSuccess(await request.delete(`/api/jobs/${jobId}`), `job ${jobId}`);
}

export async function deleteStatusPage(request: APIRequestContext, pageId: string): Promise<void> {
  if (!pageId || pageId.startsWith('mock-')) return;
  await expectCleanupSuccess(await request.delete(`/api/status-pages/${pageId}`), `status page ${pageId}`);
}
