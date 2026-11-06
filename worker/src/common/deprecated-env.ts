import { Logger } from '@nestjs/common';

const logger = new Logger('DeprecatedEnv');
const warned = new Set<string>();

/** Once per process: a deprecated environment variable is still being read. */
export function warnDeprecatedEnvOnce(name: string, replacement: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  logger.warn(
    `${name} is deprecated and will be removed in a future release; use ${replacement} instead.`,
  );
}

/** Test helper: forget which warnings were already emitted. */
export function resetDeprecatedEnvWarnings(): void {
  warned.clear();
}
