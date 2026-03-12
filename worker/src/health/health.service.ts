import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../execution/services/db.service';
import { RedisService } from '../execution/services/redis.service';
import { ErrorHandler } from '../common/utils/error-handler';
import { HeartbeatService } from '../common/heartbeat/heartbeat.service';
import { user } from '../db/schema';
import { PLAYWRIGHT_QUEUE } from '../execution/constants';
import {
  K6_QUEUE,
  k6QueueName,
} from '../k6/k6.constants';
import {
  monitorQueueName,
} from '../monitor/monitor.constants';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
    queues: ComponentHealth;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'unhealthy';
  message?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly heartbeatService: HeartbeatService,
  ) {}

  async getHealthStatus(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueues(),
    ]);

    const [database, redis, queues] = checks.map((result) =>
      result.status === 'fulfilled'
        ? result.value
        : { status: 'unhealthy' as const, message: 'Check failed' },
    );

    const overallStatus = this.determineOverallStatus([
      database,
      redis,
      queues,
    ]);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      checks: {
        database,
        redis,
        queues,
      },
    };
  }

  async getReadinessStatus(): Promise<{ status: string; ready: boolean }> {
    const health = await this.getHealthStatus();
    const ready = health.status === 'healthy';

    return {
      status: ready ? 'ready' : 'not ready',
      ready,
    };
  }

  getLivenessStatus(): { status: string; alive: boolean } {
    // Basic liveness check - service is running
    return {
      status: 'alive',
      alive: true,
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const startTime = Date.now();

    try {
      await this.dbService.db.select().from(user).limit(1);

      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        message: 'Database connection successful',
      };
    } catch (error) {
      ErrorHandler.logError(this.logger, error, 'Database health check');

      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: ErrorHandler.extractMessage(error),
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const startTime = Date.now();

    try {
      await this.redisService.ping();

      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        message: 'Redis connection successful',
      };
    } catch (error) {
      ErrorHandler.logError(this.logger, error, 'Redis health check');

      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: ErrorHandler.extractMessage(error),
      };
    }
  }

  private async checkQueues(): Promise<ComponentHealth> {
    const startTime = Date.now();

    try {
      const queueNames = this.getQueueNames();
      const results = await Promise.all(
        queueNames.map(async (name) => ({
          name,
          ok: await this.redisService.getQueueHealth(name),
        })),
      );

      const failures = results.filter((result) => !result.ok);

      if (failures.length === 0) {
        return {
          status: 'healthy',
          responseTime: Date.now() - startTime,
          message: 'All queues accessible',
          details: { queueCount: queueNames.length, queues: queueNames },
        };
      } else {
        return {
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: `${failures.length}/${queueNames.length} queues inaccessible`,
          details: {
            failureCount: failures.length,
            failedQueues: failures.map((result) => result.name),
            queues: queueNames,
          },
        };
      }
    } catch (error) {
      ErrorHandler.logError(this.logger, error, 'Queue health check');

      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: ErrorHandler.extractMessage(error),
      };
    }
  }

  private getQueueNames(): string[] {
    const heartbeatQueues = this.heartbeatService.getQueues();
    if (heartbeatQueues.length > 0) {
      return Array.from(new Set(heartbeatQueues)).sort();
    }

    const workerLocation = (
      this.configService.get<string>('WORKER_LOCATION', 'local') || 'local'
    ).toLowerCase();
    const queueNames = new Set<string>([PLAYWRIGHT_QUEUE, K6_QUEUE]);

    if (workerLocation === 'local') {
      queueNames.add(k6QueueName('local'));
      queueNames.add(monitorQueueName('local'));
    } else {
      queueNames.add(k6QueueName(workerLocation));
      queueNames.add(monitorQueueName(workerLocation));
    }

    return Array.from(queueNames).sort();
  }

  private determineOverallStatus(
    checks: ComponentHealth[],
  ): 'healthy' | 'unhealthy' | 'degraded' {
    const unhealthyCount = checks.filter(
      (check) => check.status === 'unhealthy',
    ).length;

    if (unhealthyCount === 0) {
      return 'healthy';
    } else if (unhealthyCount < checks.length) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }
}
