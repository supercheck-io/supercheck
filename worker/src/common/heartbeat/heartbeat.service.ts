import { consumesWorkerQueue } from '../worker-queues';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRedisOptions } from '../redis/redis-options';
import Redis from 'ioredis';
import { hostname } from 'os';
import { PLAYWRIGHT_QUEUE } from '../../execution/constants';
import { getServiceVersion } from '../version';

const HEARTBEAT_PREFIX = 'supercheck:worker-heartbeat:';
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_SECONDS = 60;

/** The tag, or the `@sha256:...` digest, of an image reference; never the registry or any credentials in it. */
export function imageTag(image: string | undefined): string {
  const ref = image?.trim() ?? '';
  const digest = /@([a-z0-9]+:[0-9a-f]+)$/i.exec(ref);
  if (digest) return `@${digest[1]}`;
  return /:([^:/@]+)$/.exec(ref)?.[1] ?? '';
}

/**
 * Features this worker can run. Only workers that ship the agent-test fixture send this field, so an old
 * worker reports nothing. `agent-test` is withheld only when the execution image (WORKER_IMAGE) is known
 * to be older: a full-version tag (1.4.0 or v1.4.0) must equal this worker's version. Floating or named
 * tags (1.6, prod), a digest, `latest` or no image are trusted (ops enforces digest equality).
 */
export function workerCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const tag = imageTag(env.WORKER_IMAGE).replace(/^v/, '');
  if (
    /^\d+\.\d+\.\d+/.test(tag) &&
    tag !== getServiceVersion().replace(/^v/, '')
  )
    return [];
  return ['agent-test'];
}

interface WorkerHeartbeat {
  location: string;
  hostname: string;
  startedAt: string;
  lastHeartbeat: string;
  queues: string[];
  pid: number;
  capabilities: string[];
  version: string;
  image: string | null;
}

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private redis: Redis | null = null;
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatKey: string;
  private readonly location: string;
  private readonly startedAt = new Date().toISOString();
  private readonly capabilities = workerCapabilities();
  // Advertise only queues this worker actually consumes (WORKER_QUEUES).
  private queues = new Set<string>(
    consumesWorkerQueue('global-playwright') ? [PLAYWRIGHT_QUEUE] : [],
  );

  constructor(private readonly configService: ConfigService) {
    this.location = this.configService
      .get<string>('WORKER_LOCATION', 'local')
      .toLowerCase();
    this.heartbeatKey = `${HEARTBEAT_PREFIX}${hostname()}-${process.pid}`;
  }

  async onModuleInit(): Promise<void> {
    try {
      this.redis = new Redis(
        buildRedisOptions(this.configService, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        }),
      );

      this.redis.on('error', (err) => {
        this.logger.warn(`Heartbeat Redis error: ${err.message}`);
      });

      // Send initial heartbeat
      await this.sendHeartbeat();

      // Schedule periodic heartbeats
      this.intervalRef = setInterval(
        () => void this.sendHeartbeat(),
        HEARTBEAT_INTERVAL_MS,
      );

      this.logger.log(
        `Heartbeat started for location="${this.location}" key="${this.heartbeatKey}"`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to initialize heartbeat: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }

    // Remove heartbeat key on graceful shutdown
    if (this.redis && this.redis.status !== 'end') {
      try {
        await this.redis.del(this.heartbeatKey);
        this.logger.log('Heartbeat key removed on shutdown');
      } catch {
        // Best-effort cleanup
      }
      try {
        this.redis.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    this.redis = null;
  }

  /** Register which queues this worker is processing (called by modules after startup) */
  addQueues(queues: string[]): void {
    for (const queue of queues) {
      this.queues.add(queue);
    }
    void this.sendHeartbeat();
  }

  removeQueues(queues: string[]): void {
    for (const queue of queues) {
      this.queues.delete(queue);
    }
    void this.sendHeartbeat();
  }

  getQueues(): string[] {
    return Array.from(this.queues);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.redis || this.redis.status === 'end') return;

    const payload: WorkerHeartbeat = {
      location: this.location,
      hostname: hostname(),
      startedAt: this.startedAt,
      lastHeartbeat: new Date().toISOString(),
      queues: this.getQueues(),
      pid: process.pid,
      capabilities: this.capabilities,
      version: getServiceVersion(),
      image: imageTag(process.env.WORKER_IMAGE) || null,
    };

    try {
      await this.redis.set(
        this.heartbeatKey,
        JSON.stringify(payload),
        'EX',
        HEARTBEAT_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Heartbeat send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
