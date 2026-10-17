/**
 * Jest setup for Worker tests.
 *
 * Expected application logging is silenced through NestJS's own logger switch
 * rather than by replacing `process.stdout.write` / `process.stderr.write`.
 * Stream patching also swallowed crash diagnostics (OOM kills, unhandled
 * rejections, V8 failures, child-process output), so a broken test could look
 * quiet rather than broken.
 *
 * `Logger.overrideLogger(false)` still runs the `Logger.prototype` methods, so
 * suites can keep asserting on them with `jest.spyOn(Logger.prototype, ...)`.
 * Run a suite with `DEBUG=1` or `VERBOSE=1` to see Nest logging again.
 */
import { Logger } from '@nestjs/common';

beforeAll(() => {
  if (process.env.DEBUG || process.env.VERBOSE) {
    return;
  }
  // Optional calls keep suites that mock '@nestjs/common' working even when the
  // mock omits the Logger class entirely.
  Logger?.overrideLogger?.(false);
});
