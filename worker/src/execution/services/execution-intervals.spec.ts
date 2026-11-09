/**
 * onModuleDestroy must clear every interval the service starts, including the
 * manual-GC one that only exists when Node runs with --expose-gc.
 */
import type { ConfigService } from '@nestjs/config';
import { ExecutionService } from './execution.service';

function createService() {
  return new ExecutionService(
    { get: () => undefined } as unknown as ConfigService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('ExecutionService intervals', () => {
  const originalGc = global.gc;
  afterEach(() => {
    global.gc = originalGc;
    jest.restoreAllMocks();
  });

  it.each([
    ['without global.gc', undefined, 1],
    ['with global.gc', jest.fn(), 2],
  ])('clears all intervals on destroy %s', (_label, gc, expected) => {
    global.gc = gc as typeof global.gc;
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');

    const started = () =>
      setSpy.mock.results.map((r) => r.value as NodeJS.Timeout);
    try {
      createService().onModuleDestroy();
      // A new constructor interval must be cleared in onModuleDestroy and counted here.
      expect(started()).toHaveLength(expected);
      for (const handle of started())
        expect(clearSpy).toHaveBeenCalledWith(handle);
    } finally {
      // A regression fails this test instead of leaving a live interval that hangs Jest.
      for (const handle of started()) clearInterval(handle);
    }
  });
});
