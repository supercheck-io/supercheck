import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../execution/services/db.service';
import { RedisService } from '../execution/services/redis.service';
import { ErrorHandler } from '../common/utils/error-handler';
import { user } from '../db/schema';

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
      // Basic queue health check - verify we can get queue info
      const queueNames = [
        'job-execution',
        'test-execution',
        'monitor-execution',
      ];
      const results = await Promise.allSettled(
        queueNames.map((name) => this.redisService.getQueueHealth(name)),
      );

      const failures = results.filter((result) => result.status === 'rejected');

      if (failures.length === 0) {
        return {
          status: 'healthy',
          responseTime: Date.now() - startTime,
          message: 'All queues accessible',
          details: { queueCount: queueNames.length },
        };
      } else {
        return {
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: `${failures.length}/${queueNames.length} queues inaccessible`,
          details: { failureCount: failures.length },
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
