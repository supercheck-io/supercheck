/**
 * Jest setup for Worker tests.
 *
 * Expected application logging is silenced through NestJS's own logger switch
 * rather than by replacing `process.stdout.write` / `process.stderr.write`.
 * Stream patching also swallowed crash diagnostics (OOM kills, unhandled
 * rejections, V8 failures, child-process output), so a broken test could look
 * quiet rather than broken — it hid the 16 `this.errorHandler.mapError is not a
 * function` TypeErrors in monitor.service.spec.ts.
 *
 * `Logger.overrideLogger(false)` still runs the `Logger.prototype` methods, so
 * suites can keep asserting on them with `jest.spyOn(Logger.prototype, ...)`.
 * `jest.requireActual` is deliberate: the one suite that mocks
 * `@nestjs/common` replaces the `Logger` export, and resolving the real class
 * keeps the override applying instead of silently no-oping. Output written
 * through `console.*` in code under test stays visible on purpose — that is the
 * diagnostic that was previously filtered away.
 *
 * Run a suite with `DEBUG=1` or `VERBOSE=1` to see Nest logging again.
 */
beforeAll(() => {
  if (process.env.DEBUG || process.env.VERBOSE) {
    return;
  }
  const { Logger } =
    jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');
  Logger.overrideLogger(false);
});
