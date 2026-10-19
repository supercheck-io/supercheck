import { ResourceManagerService } from './resource-manager.service';

describe('operation timeout cleanup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each([false, true])(
    'clears a completed operation timer when rejection=%s',
    async (reject) => {
      const service = new ResourceManagerService();
      const baseline = jest.getTimerCount();
      try {
        const operation = service.executeWithResourceLimits(
          'request',
          async () => {
            if (reject) throw new Error('failed');
            return 'ok';
          },
          { timeoutMs: 60_000 },
        );
        if (reject) await expect(operation).rejects.toThrow('failed');
        else await expect(operation).resolves.toBe('ok');
        expect(jest.getTimerCount()).toBe(baseline);
      } finally {
        service.shutdown();
      }
    },
  );
});
