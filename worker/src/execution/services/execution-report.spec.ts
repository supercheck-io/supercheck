/**
 * Report evaluation and the variable/secret runtime helpers.
 *
 * These sit on the boundary between the worker and the user's test script:
 * - `evaluatePlaywrightReport` decides pass/fail, including the flaky-retry rule
 *   where a test that failed then passed must not fail the run.
 * - `prependVariableRuntimeHelpers` is what `getVariable`/`getSecret`/`getFile`
 *   in a customer script actually execute.
 * - `redactSecretsFromText` decides what secrets can reach stored logs.
 *
 * Filesystem access is real here (temp directories) instead of mocked, so a
 * change to the report path layout fails these tests.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ConfigService } from '@nestjs/config';
import { ExecutionService } from './execution.service';

function createService(env: Record<string, string> = {}) {
  const configService = {
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService;
  const unused = () => {
    throw new Error('dependency not used by this test');
  };
  return new ExecutionService(
    configService,
    { uploadReport: unused } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function writeResults(directory: string, report: unknown): void {
  writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report));
}

function test(title: string, statuses: string[]) {
  return {
    title,
    titlePath: ['chromium', title],
    results: statuses.map((status) => ({ status })),
  };
}

describe('ExecutionService report evaluation', () => {
  let service: ExecutionService;
  let directory: string;

  beforeEach(() => {
    service = createService();
    directory = mkdtempSync(path.join(tmpdir(), 'supercheck-report-'));
  });

  afterEach(() => {
    service.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  });

  function evaluate() {
    return service['evaluatePlaywrightReport'](directory);
  }

  it('treats a report whose tests all passed as a pass', async () => {
    writeResults(directory, {
      suites: [{ specs: [{ tests: [test('a', ['passed'])] }] }],
    });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: false,
      foundReport: true,
    });
  });

  it('treats a flaky test that passed on retry as a pass', async () => {
    writeResults(directory, {
      suites: [{ specs: [{ tests: [test('flaky', ['failed', 'passed'])] }] }],
    });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: false,
      foundReport: true,
    });
  });

  it('fails the run when a test only ever failed', async () => {
    writeResults(directory, {
      suites: [
        {
          specs: [
            {
              tests: [
                test('good', ['passed']),
                test('bad', ['failed', 'failed']),
              ],
            },
          ],
        },
      ],
    });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: true,
      foundReport: true,
    });
  });

  it('falls back to the summary counters when no test tree is present', async () => {
    writeResults(directory, { summary: { failed: 2, passed: 10 } });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: true,
      foundReport: true,
    });
  });

  it.each([
    ['timedout', true],
    ['failed', true],
    ['passed', false],
    ['success', false],
  ])('uses the top-level status %s', async (status, expectedFailure) => {
    writeResults(directory, { status });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: expectedFailure,
      foundReport: true,
    });
  });

  it('deep-scans an unknown shape for a failed status', async () => {
    writeResults(directory, { nested: { deeper: [{ status: 'timedout' }] } });

    await expect(evaluate()).resolves.toEqual({
      hasFailures: true,
      foundReport: true,
    });
  });

  it('treats a missing report as a failure so a lost artifact cannot look green', async () => {
    await expect(evaluate()).resolves.toEqual({
      hasFailures: true,
      foundReport: false,
    });
  });

  it('treats an unparseable report as a failure', async () => {
    writeFileSync(
      path.join(directory, 'results.json'),
      '<html>not json</html>',
    );

    await expect(evaluate()).resolves.toEqual({
      hasFailures: true,
      foundReport: false,
    });
  });

  it('reads the report from the extracted directory it is given', async () => {
    const nested = path.join(directory, 'report');
    mkdirSync(nested);
    writeResults(nested, { status: 'passed' });

    await expect(service['evaluatePlaywrightReport'](nested)).resolves.toEqual({
      hasFailures: false,
      foundReport: true,
    });
  });
});

describe('ExecutionService variable and secret transport', () => {
  let service: ExecutionService;

  beforeEach(() => {
    service = createService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('encodes variables, secrets and file paths into separate base64 transport fields', () => {
    const env = service['buildVariableRuntimeEnv'](
      { BASE_URL: 'https://example.test' },
      { TOKEN: 's3cret' },
      { UPLOAD: 'files/upload-1.json' },
    );

    expect(Object.keys(env).sort()).toEqual([
      'SUPERCHECK_FILES_B64',
      'SUPERCHECK_SECRETS_B64',
      'SUPERCHECK_VARIABLES_B64',
    ]);
    expect(
      JSON.parse(
        Buffer.from(env.SUPERCHECK_VARIABLES_B64, 'base64').toString(),
      ),
    ).toEqual({
      BASE_URL: 'https://example.test',
    });
    expect(
      JSON.parse(Buffer.from(env.SUPERCHECK_SECRETS_B64, 'base64').toString()),
    ).toEqual({
      TOKEN: 's3cret',
    });
    expect(
      JSON.parse(Buffer.from(env.SUPERCHECK_FILES_B64, 'base64').toString()),
    ).toEqual({
      UPLOAD: 'files/upload-1.json',
    });
  });

  it('defaults every transport field to an empty map', () => {
    const env = service['buildVariableRuntimeEnv']({}, {});

    expect(
      JSON.parse(Buffer.from(env.SUPERCHECK_FILES_B64, 'base64').toString()),
    ).toEqual({});
  });

  it('round-trips secrets and ignores non-string or malformed payloads', () => {
    const env = service['buildVariableRuntimeEnv'](
      {},
      { TOKEN: 's3cret', COUNT: '2' },
    );

    expect(service['decodeRuntimeSecretsFromEnv'](env)).toEqual({
      TOKEN: 's3cret',
      COUNT: '2',
    });
    expect(
      service['decodeRuntimeSecretsFromEnv']({
        SUPERCHECK_SECRETS_B64: 'not-base64!!',
      }),
    ).toEqual({});
    expect(
      service['decodeRuntimeSecretsFromEnv']({
        SUPERCHECK_SECRETS_B64: Buffer.from('[1,2]').toString('base64'),
      }),
    ).toEqual({});
    expect(
      service['decodeRuntimeSecretsFromEnv']({
        SUPERCHECK_SECRETS_B64: Buffer.from(
          '{"TOKEN": 5, "OK": "yes"}',
        ).toString('base64'),
      }),
    ).toEqual({ OK: 'yes' });
    expect(service['decodeRuntimeSecretsFromEnv'](undefined)).toEqual({});
  });

  describe('redactSecretsFromText', () => {
    it('replaces every occurrence of each secret', () => {
      const redacted = service['redactSecretsFromText'](
        'token=abc and abc again',
        { TOKEN: 'abc' },
      );

      expect(redacted).toBe('token=[SECRET] and [SECRET] again');
    });

    it('replaces the longest overlapping secret first', () => {
      const redacted = service['redactSecretsFromText']('abcdef', {
        SHORT: 'abc',
        LONG: 'abcdef',
      });

      expect(redacted).toBe('[SECRET]');
    });

    it('handles secrets containing regular-expression metacharacters', () => {
      const redacted = service['redactSecretsFromText']('value a$b.*c!', {
        TOKEN: 'a$b.*c',
      });

      expect(redacted).toBe('value [SECRET]!');
    });

    it('leaves text untouched when there is nothing to redact', () => {
      expect(service['redactSecretsFromText']('plain', {})).toBe('plain');
      expect(service['redactSecretsFromText'](null, { TOKEN: 'secret' })).toBe(
        '',
      );
      expect(
        service['redactSecretsFromText'](undefined, { TOKEN: 'secret' }),
      ).toBe('');
      expect(service['redactSecretsFromText']('plain', { EMPTY: '' })).toBe(
        'plain',
      );
    });
  });

  describe('runtime helpers injected into user scripts', () => {
    const baseUrlEnv = () => ({
      SUPERCHECK_VARIABLES_B64: Buffer.from(
        JSON.stringify({
          BASE_URL: 'https://example.test',
          RETRIES: '3',
          ENABLED: 'true',
          EMPTY: '',
        }),
      ).toString('base64'),
      SUPERCHECK_SECRETS_B64: Buffer.from(
        JSON.stringify({ TOKEN: 'super-secret-value', PORT: '8443' }),
      ).toString('base64'),
      SUPERCHECK_FILES_B64: Buffer.from(
        JSON.stringify({ UPLOAD: 'files/upload-1.json' }),
      ).toString('base64'),
      TMPDIR: '/tmp/supercheck-run',
    });

    function evaluateScript(body: string) {
      const previousEnv = process.env;
      process.env = { ...previousEnv, ...baseUrlEnv() } as NodeJS.ProcessEnv;
      try {
        const context: Record<string, unknown> = {
          process,
          console: { log: () => undefined, error: () => undefined },
          Buffer,
          require: () => ({ readFileSync: () => 'file-contents' }),
        };
        runInNewContext(service['prependVariableRuntimeHelpers'](''), context);
        return runInNewContext(body, context);
      } finally {
        process.env = previousEnv;
      }
    }

    it('reads plain variables with defaults and type coercion', () => {
      expect(evaluateScript('getVariable("BASE_URL")')).toBe(
        'https://example.test',
      );
      expect(evaluateScript('getVariable("MISSING")')).toBe('');
      expect(
        evaluateScript('getVariable("MISSING", { default: "fallback" })'),
      ).toBe('fallback');
      expect(evaluateScript('getVariable("RETRIES", { type: "number" })')).toBe(
        3,
      );
      expect(
        evaluateScript('getVariable("ENABLED", { type: "boolean" })'),
      ).toBe(true);
      expect(evaluateScript('getVariable("EMPTY", { type: "boolean" })')).toBe(
        false,
      );
    });

    it('throws for a required variable that is not defined', () => {
      expect(() =>
        evaluateScript('getVariable("MISSING", { required: true })'),
      ).toThrow("Required variable 'MISSING' is not defined");
    });

    it('throws when a variable cannot be converted to a number', () => {
      expect(() =>
        evaluateScript('getVariable("BASE_URL", { type: "number" })'),
      ).toThrow("Variable 'BASE_URL' cannot be converted to number");
    });

    it('reads secrets and keeps their numeric coercion separate', () => {
      expect(evaluateScript('getSecret("TOKEN")')).toBe('super-secret-value');
      expect(evaluateScript('getSecret("PORT", { type: "number" })')).toBe(
        8443,
      );
      expect(evaluateScript('getSecret("MISSING", { default: "none" })')).toBe(
        'none',
      );
      expect(() =>
        evaluateScript('getSecret("MISSING", { required: true })'),
      ).toThrow("Required secret 'MISSING' is not defined");
    });

    it('resolves file variables inside the run temp directory', () => {
      expect(evaluateScript('getFile("UPLOAD")')).toBe(
        '/tmp/supercheck-run/files/upload-1.json',
      );
      expect(evaluateScript('readFile("UPLOAD")')).toBe('file-contents');
      expect(() => evaluateScript('getFile("MISSING")')).toThrow(
        "File variable 'MISSING' is not defined",
      );
    });

    it('redacts secrets from console output inside the script', () => {
      const lines: unknown[][] = [];
      const previousEnv = process.env;
      process.env = { ...previousEnv, ...baseUrlEnv() } as NodeJS.ProcessEnv;
      try {
        const context: Record<string, unknown> = {
          process,
          console: {
            log: (...args: unknown[]) => lines.push(args),
            error: () => undefined,
          },
          Buffer,
        };
        runInNewContext(service['prependVariableRuntimeHelpers'](''), context);
        runInNewContext(
          'console.log("token=" + getSecret("TOKEN"), { nested: getSecret("TOKEN") })',
          context,
        );
      } finally {
        process.env = previousEnv;
      }

      expect(lines).toEqual([['token=[SECRET]', { nested: '[SECRET]' }]]);
    });
  });
});
