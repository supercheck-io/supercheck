import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { hostname } from 'os';
import { PLAYWRIGHT_QUEUE } from '../../execution/constants';

const HEARTBEAT_PREFIX = 'supercheck:worker-heartbeat:';
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_SECONDS = 60;

interface WorkerHeartbeat {
  location: string;
  hostname: string;
  startedAt: string;
  lastHeartbeat: string;
  queues: string[];
  pid: number;
}

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private redis: Redis | null = null;
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatKey: string;
  private readonly location: string;
  private readonly startedAt = new Date().toISOString();
  private queues = new Set<string>([PLAYWRIGHT_QUEUE]);

  constructor(private readonly configService: ConfigService) {
    this.location = this.configService
      .get<string>('WORKER_LOCATION', 'local')
      .toLowerCase();
    this.heartbeatKey = `${HEARTBEAT_PREFIX}${hostname()}-${process.pid}`;
  }

  async onModuleInit(): Promise<void> {
    try {
      const redisHost = this.configService.get<string>(
        'REDIS_HOST',
        'localhost',
      );
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');
      const tlsEnabled =
        this.configService.get<string>('REDIS_TLS_ENABLED') === 'true';

      this.redis = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword || undefined,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        ...(tlsEnabled && {
          tls: {
            rejectUnauthorized:
              this.configService.get<string>(
                'REDIS_TLS_REJECT_UNAUTHORIZED',
              ) !== 'false',
          },
        }),
      });

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
