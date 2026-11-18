import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAgentSummaries } from './agent-summary';

// The shape Playwright's JSON reporter writes for `<id>.agent.spec.ts`: file suite -> specs -> tests -> results.
const report = (attachmentPath: string) => ({
  suites: [
    {
      title: 'abc-123.agent.spec.ts',
      file: 'abc-123.agent.spec.ts',
      specs: [
        {
          title: 'repeat one',
          file: 'abc-123.agent.spec.ts',
          line: 4,
          tests: [
            {
              projectName: 'agent',
              results: [
                {
                  status: 'passed',
                  attachments: [
                    {
                      name: 'agent-summary',
                      contentType: 'application/json',
                      path: attachmentPath,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('readAgentSummaries', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-summary-'));
    // what the worker extracts from the pod's playwright-reports dir
    const out = join(
      dir,
      'output-x',
      'abc-123.agent-repeat-one-agent',
      'attachments',
    );
    await mkdir(out, { recursive: true });
    await writeFile(
      join(out, 'agent-summary-h.json'),
      JSON.stringify({ title: 'repeat one', attempts: 3, passed: 3 }),
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const rel =
    'output-x/abc-123.agent-repeat-one-agent/attachments/agent-summary-h.json';

  it.each([
    ['plain /tmp', `/tmp/playwright-reports/${rel}`],
    // Kubernetes rewrites /tmp to the run's workspace, so the pod path is not /tmp/playwright-reports
    [
      'Kubernetes workspace',
      `/tmp/supercheck/run-0123abcd/playwright-reports/${rel}`,
    ],
  ])('reads the summary from a %s attachment path', async (_name, p) => {
    const tests = await readAgentSummaries(report(p), dir);
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({
      testId: 'abc-123',
      attempts: 3,
      passed: 3,
    });
  });

  it('ignores a path outside the reports dir', async () => {
    expect(await readAgentSummaries(report('/etc/passwd'), dir)).toEqual([]);
    expect(
      await readAgentSummaries(
        report('/tmp/supercheck/run-1/playwright-reports/../../etc/passwd'),
        dir,
      ),
    ).toEqual([]);
  });
});
