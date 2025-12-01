/**
 * Jest setup for Worker tests
 * Suppresses expected console output and NestJS Logger during tests
 */

// Suppress NestJS Logger output by intercepting stdout/stderr
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const suppressedPatterns = [
  '[K6ExecutionService]',
  '[MonitorService]',
  '[NotificationService]',
  '[PlaywrightExecutionProcessor]',
  '[ExecutionService]',
  'CRITICAL: K6',
  'Error executing monitor',
  'errorHandler.mapError',
  'xk6-dashboard',
  '[Nest]',
  'k6 binary',
  'web-dashboard',
  'ERROR',
  'Error:',
  'html report',
  'Container failed',
  'Cancellation requested',
  'Process exited with code',
  'Process cancelled',
  'Process cancellation',
  'Process code 137',
  'Timeout exceeded',
  'playwright-execution.processor.spec.ts',
];

beforeAll(() => {
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (suppressedPatterns.some(pattern => str.includes(pattern))) {
      return true;
    }
    return originalStdoutWrite(chunk, ...args);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (suppressedPatterns.some(pattern => str.includes(pattern))) {
      return true;
    }
    return originalStderrWrite(chunk, ...args);
  }) as typeof process.stderr.write;
});

afterAll(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});
