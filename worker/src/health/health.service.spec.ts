import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { DbService } from '../execution/services/db.service';
import { RedisService } from '../execution/services/redis.service';
import { HeartbeatService } from '../common/heartbeat/heartbeat.service';

describe('HealthService', () => {
  let service: HealthService;
  let _redisService: RedisService;

  const mockDbService = {
    db: {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    },
  };

  const mockRedisService = {
    ping: jest.fn().mockResolvedValue('PONG'),
    getQueueHealth: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockHeartbeatService = {
    getQueues: jest.fn().mockReturnValue([
      'playwright-global',
      'k6-global',
      'monitor-local',
    ]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DbService, useValue: mockDbService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HeartbeatService, useValue: mockHeartbeatService },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    _redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when all checks pass', async () => {
      // Mock successful queue checks for ONLY the expected queues
      mockRedisService.getQueueHealth.mockResolvedValue({
        status: 'healthy',
        message: 'Queue is healthy',
      });

      const result = await service.getHealthStatus();

      expect(result.status).toBe('healthy');
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('healthy');
      expect(result.checks.queues.status).toBe('healthy');
    });

    it('should check the queues registered for this worker', async () => {
      mockRedisService.getQueueHealth.mockResolvedValue({
        status: 'healthy',
        message: 'Queue is healthy',
      });

      await service.getHealthStatus();

      // Verify explicit queue names
      expect(mockRedisService.getQueueHealth).toHaveBeenCalledWith(
        'playwright-global',
      );
      expect(mockRedisService.getQueueHealth).toHaveBeenCalledWith('k6-global');
      expect(mockRedisService.getQueueHealth).toHaveBeenCalledWith(
        'monitor-local',
      );
    });

    it('should return unhealthy overall if a check fails', async () => {
      // Mock DB failure
      mockDbService.db.select.mockImplementationOnce(() => {
        throw new Error('DB Connection Failed');
      });

      mockRedisService.getQueueHealth.mockResolvedValue({
        status: 'healthy',
      });

      const result = await service.getHealthStatus();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('unhealthy');
    });
  });

  describe('getReadinessStatus', () => {
    it('should be ready if health is healthy', async () => {
      jest.spyOn(service, 'getHealthStatus').mockResolvedValue({
        status: 'healthy',
        timestamp: '',
        version: '',
        uptime: 0,
        checks: {} as any,
      });

      const result = await service.getReadinessStatus();
      expect(result.ready).toBe(true);
      expect(result.status).toBe('ready');
    });

    it('should not be ready if health is unhealthy', async () => {
      jest.spyOn(service, 'getHealthStatus').mockResolvedValue({
        status: 'unhealthy',
        timestamp: '',
        version: '',
        uptime: 0,
        checks: {} as any,
      });

      const result = await service.getReadinessStatus();
      expect(result.ready).toBe(false);
      expect(result.status).toBe('not ready');
    });
  });

  describe('getLivenessStatus', () => {
    it('should always return alive', () => {
      const result = service.getLivenessStatus();
      expect(result.alive).toBe(true);
      expect(result.status).toBe('alive');
    });
  });
});
