import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

function parseSentinels(
  value: string | undefined,
): Array<{ host: string; port: number }> {
  if (!value) return [];
  return value.split(',').map((entry) => {
    const trimmed = entry.trim();
    const separator = trimmed.lastIndexOf(':');
    const host = trimmed.slice(0, separator);
    const port = Number(trimmed.slice(separator + 1));
    if (
      separator <= 0 ||
      !host ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error(`Invalid REDIS_SENTINELS entry: ${trimmed}`);
    }
    return { host, port };
  });
}

/** Builds one failover-safe Redis configuration for BullMQ and direct clients. */
export function buildRedisOptions(
  config: ConfigService,
  overrides: Partial<RedisOptions> = {},
): RedisOptions {
  const sentinels = parseSentinels(config.get<string>('REDIS_SENTINELS'));
  const tlsEnabled =
    config.get<string>('REDIS_TLS_ENABLED', 'false') === 'true';
  return {
    ...(sentinels.length > 0
      ? {
          sentinels,
          name: config.get<string>('REDIS_SENTINEL_MASTER', 'mymaster'),
          sentinelPassword:
            config.get<string>('REDIS_SENTINEL_PASSWORD') || undefined,
          sentinelRetryStrategy: (attempt: number) =>
            Math.min(attempt * 250, 3000),
        }
      : {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
        }),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    username: config.get<string>('REDIS_USERNAME') || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 3000),
    ...(tlsEnabled && {
      tls: {
        rejectUnauthorized:
          config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED', 'true') !==
          'false',
      },
    }),
    ...overrides,
  };
}
