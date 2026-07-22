import { test as base } from '@playwright/test';

type CleanupCallback = () => Promise<void>;

export type CleanupRegistry = {
  add(label: string, callback: CleanupCallback): void;
};

type CleanupFixtures = {
  cleanup: CleanupRegistry;
};

export const test = base.extend<CleanupFixtures>({
  cleanup: async ({}, use) => {
    const callbacks: Array<{ label: string; callback: CleanupCallback }> = [];
    const registry: CleanupRegistry = {
      add(label, callback) {
        callbacks.push({ label, callback });
      },
    };

    await use(registry);

    const failures: string[] = [];
    for (const entry of callbacks.reverse()) {
      try {
        await entry.callback();
      } catch (error) {
        failures.push(
          `${entry.label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`E2E cleanup failed:\n${failures.join('\n')}`);
    }
  },
});
