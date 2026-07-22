import { APIRequestContext } from '@playwright/test';

/**
 * Seeding utilities for E2E tests
 */

let cachedProjectId: string | null = null;

async function getProjectHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  if (cachedProjectId) {
    return { 'x-project-id': cachedProjectId };
  }
  try {
    const res = await request.get('/api/projects');
    if (res.ok()) {
      const json = await res.json();
      const project = json.currentProject || (json.data && json.data[0]);
      if (project?.id) {
        cachedProjectId = project.id;
        return { 'x-project-id': project.id };
      }
    }
  } catch {}
  return {};
}
/**
 * Create a new test via API
 */
export async function createTest(request: APIRequestContext, overrides: Record<string, any> = {}): Promise<{ id: string; title: string }> {
  const title = overrides.title || `E2E Seed Test ${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  let headers = await getProjectHeaders(request);

  let createRes = await request.post('/api/tests', {
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

  if (createRes.status() === 401 && !headers['x-project-id']) {
    // Retry once after explicitly fetching project header
    headers = await getProjectHeaders(request);
    createRes = await request.post('/api/tests', {
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
  }

  if (!createRes.ok()) {
    throw new Error(`Failed to create test: ${createRes.status()} ${await createRes.text()}`);
  }

  const createData = await createRes.json();
  const testId = createData.test?.id || createData.id;
  return { id: testId, title };
}


export async function ensureTestExists(request: APIRequestContext): Promise<{ id: string; created: boolean }> {
  try {
    const listRes = await request.get('/api/tests');
    if (listRes.ok()) {
      const listData = await listRes.json();
      if (listData.data && listData.data.length > 0) {
        return { id: listData.data[0].id, created: false };
      }
    }
  } catch (err) {
    console.error('Error fetching tests for seed check:', err);
  }

  const newTest = await createTest(request);
  return { id: newTest.id, created: true };
}

export async function deleteTest(request: APIRequestContext, testId: string): Promise<void> {
  if (!testId) return;
  await request.delete(`/api/tests/${testId}`).catch((err) => {
    console.error(`Failed to delete test ${testId}:`, err);
  });
}

/**
 * Create a new monitor via API
 */
export async function createMonitor(request: APIRequestContext, overrides: Record<string, any> = {}): Promise<{ id: string; name: string }> {
  const name = overrides.name || `E2E Seed Monitor ${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const headers = await getProjectHeaders(request);
  const createRes = await request.post('/api/monitors', {
    headers,
    data: {
      name,
      type: 'http_request',
      target: 'https://httpbin.org/status/200',
      frequencyMinutes: 5,
      ...overrides,
    }
  });

  if (!createRes.ok()) {
    throw new Error(`Failed to create monitor: ${createRes.status()} ${await createRes.text()}`);
  }

  const createData = await createRes.json();
  const monitorId = createData.id || createData.monitor?.id;
  return { id: monitorId, name };
}

export async function ensureMonitorExists(request: APIRequestContext): Promise<{ id: string; created: boolean }> {
  try {
    const headers = await getProjectHeaders(request);
    const listRes = await request.get('/api/monitors', { headers });
    if (listRes.ok()) {
      const listData = await listRes.json();
      if (listData.data && listData.data.length > 0) {
        return { id: listData.data[0].id, created: false };
      }
    }
  } catch (err) {
    console.error('Error fetching monitors for seed check:', err);
  }

  const newMon = await createMonitor(request);
  return { id: newMon.id, created: true };
}

export async function deleteMonitor(request: APIRequestContext, monitorId: string): Promise<void> {
  if (!monitorId) return;
  const headers = await getProjectHeaders(request);
  await request.delete(`/api/monitors/${monitorId}`, { headers }).catch((err) => {
    console.error(`Failed to delete monitor ${monitorId}:`, err);
  });
}

/**
 * Create a new job via API
 */
export async function createJob(request: APIRequestContext, overrides: Record<string, any> = {}): Promise<{ id: string; name: string; createdTestId?: string }> {
  let testId = overrides.testId;
  let testCreated = false;
  if (!testId) {
    const newTest = await createTest(request);
    testId = newTest.id;
    testCreated = true;
  }

  const name = overrides.name || `E2E Seed Job ${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
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
    throw new Error(`Failed to create job: ${createRes.status()} ${await createRes.text()}`);
  }

  const createData = await createRes.json();
  const jobId = createData.job?.id || createData.id;
  return { id: jobId, name, createdTestId: testCreated ? testId : undefined };
}

export async function ensureJobExists(request: APIRequestContext): Promise<{ id: string; created: boolean; createdTestId?: string }> {
  try {
    const listRes = await request.get('/api/jobs');
    if (listRes.ok()) {
      const listData = await listRes.json();
      if (listData.data && listData.data.length > 0) {
        return { id: listData.data[0].id, created: false };
      }
    }
  } catch (err) {
    console.error('Error fetching jobs for seed check:', err);
  }

  const newJob = await createJob(request);
  return {
    id: newJob.id,
    created: true,
    createdTestId: newJob.createdTestId
  };
}

export async function deleteJob(request: APIRequestContext, jobId: string): Promise<void> {
  if (!jobId) return;
  await request.delete(`/api/jobs/${jobId}`).catch((err) => {
    console.error(`Failed to delete job ${jobId}:`, err);
  });
}

/**
 * Status Pages test data utilities
 */
export async function createStatusPage(request: APIRequestContext, overrides: Record<string, any> = {}): Promise<{ id: string; title: string }> {
  const title = overrides.title || `E2E Status Page ${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const createRes = await request.post('/api/status-pages', {
    data: {
      title,
      name: title,
      description: 'E2E test status page',
      isPublic: true,
      ...overrides,
    }
  });

  if (!createRes.ok()) {
    throw new Error(`Failed to create status page: ${createRes.status()} ${await createRes.text()}`);
  }

  const data = await createRes.json();
  const pageId = data.data?.id || data.id;
  if (!pageId) {
    throw new Error('Failed to create status page: response did not include an ID');
  }
  return { id: pageId, title };
}

export async function deleteStatusPage(request: APIRequestContext, pageId: string): Promise<void> {
  if (!pageId || pageId.startsWith('mock-')) return;
  await request.delete(`/api/status-pages/${pageId}`).catch(() => {});
}

/**
 * Requirements test data utilities
 */
export async function createRequirement(request: APIRequestContext, overrides: Record<string, any> = {}): Promise<{ id: string; title: string }> {
  const title = overrides.title || `E2E Requirement ${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const createRes = await request.post('/api/requirements', {
    data: {
      title,
      description: 'Created automatically by E2E test suite',
      priority: 'high',
      ...overrides,
    }
  });

  if (!createRes.ok()) {
    throw new Error(`Failed to create requirement: ${createRes.status()} ${await createRes.text()}`);
  }

  const data = await createRes.json();
  const requirementId = data.data?.id || data.id;
  if (!requirementId) {
    throw new Error('Failed to create requirement: response did not include an ID');
  }
  return { id: requirementId, title };
}

export async function deleteRequirement(request: APIRequestContext, reqId: string): Promise<void> {
  if (!reqId || reqId.startsWith('req-')) return;
  await request.delete(`/api/requirements/${reqId}`).catch(() => {});
}
