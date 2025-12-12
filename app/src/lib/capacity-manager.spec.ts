/**
 * Capacity Manager Tests
 * 
 * Comprehensive test coverage for Redis-based atomic capacity management
 * 
 * Test Categories:
 * - Slot Reservation (running/queued capacity)
 * - Slot Release (job completion/failure)
 * - Queue Management (addToQueue, processQueuedJobs)
 * - Capacity Queries (current usage)
 * - Security (atomic operations, race conditions)
 * - Edge Cases (counter drift, recovery)
 */

// Mock plan enforcement first
jest.mock('./middleware/plan-enforcement', () => ({
  checkCapacityLimits: jest.fn(),
}));

// Mock queue module (for getRedisConnection needed by getCapacityManager)
jest.mock('./queue', () => ({
  getRedisConnection: jest.fn(),
  getQueues: jest.fn(),
}));

import { CapacityManager, QueuedJobData, setCapacityLogger } from './capacity-manager';
import { checkCapacityLimits } from './middleware/plan-enforcement';
import { getRedisConnection } from './queue';

const mockCheckCapacityLimits = checkCapacityLimits as jest.Mock;
const mockGetRedisConnection = getRedisConnection as jest.Mock;

// Mock Redis
const mockRedisEval = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisDecr = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisScan = jest.fn();
const mockRedisKeys = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisPipeline = jest.fn();
const mockRedisZadd = jest.fn();
const mockRedisZcard = jest.fn();
const mockRedisZrange = jest.fn();
const mockRedisZrem = jest.fn();
const mockRedisZrank = jest.fn();

const mockRedis: unknown = {
  eval: mockRedisEval,
  get: mockRedisGet,
  set: mockRedisSet,
  incr: mockRedisIncr,
  decr: mockRedisDecr,
  del: mockRedisDel,
  scan: mockRedisScan,
  keys: mockRedisKeys,
  expire: mockRedisExpire,
  pipeline: mockRedisPipeline,
  zadd: mockRedisZadd,
  zcard: mockRedisZcard,
  zrange: mockRedisZrange,
  zrem: mockRedisZrem,
  zrank: mockRedisZrank,
};

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('CapacityManager', () => {
  let capacityManager: CapacityManager;

  const testOrgId = 'org-test-123';
  
  const defaultCapacityLimits = {
    runningCapacity: 5,
    queuedCapacity: 50,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capacityManager = new CapacityManager(mockRedis as import('ioredis').default);
    
    // Inject mock logger
    setCapacityLogger(mockLogger);
    
    // Default mock implementations
    mockGetRedisConnection.mockResolvedValue(mockRedis);
    mockCheckCapacityLimits.mockResolvedValue(defaultCapacityLimits);
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisIncr.mockResolvedValue(1);
    mockRedisDecr.mockResolvedValue(0);
    mockRedisDel.mockResolvedValue(1);
    mockRedisScan.mockResolvedValue(['0', []]); // cursor=0 signals end of scan
    mockRedisKeys.mockResolvedValue([]); // For resetCounters
    mockRedisExpire.mockResolvedValue(1);
    mockRedisZadd.mockResolvedValue(1);
    mockRedisZcard.mockResolvedValue(0);
    mockRedisZrange.mockResolvedValue([]);
    mockRedisZrem.mockResolvedValue(1);
    mockRedisZrank.mockResolvedValue(0);
    
    // Default pipeline mock
    const mockPipelineInstance = {
      zadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 1], [null, 'OK'], [null, 'OK']]),
    };
    mockRedisPipeline.mockReturnValue(mockPipelineInstance);
  });

  // ==========================================================================
  // SLOT RESERVATION TESTS
  // ==========================================================================

  describe('Slot Reservation', () => {
    describe('reserveSlot', () => {
      describe('Positive Cases', () => {
        it('should reserve slot when capacity available (can run immediately)', async () => {
          mockRedisEval.mockResolvedValue(1); // 1 = can run immediately
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(1);
          expect(mockRedisEval).toHaveBeenCalled();
        });

        it('should reserve slot when must wait in queue', async () => {
          mockRedisEval.mockResolvedValue(2); // 2 = must wait in queue
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(2);
        });

        it('should use global key when no organizationId provided', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot();
          
          expect(mockRedisEval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            'capacity:running:global',
            'capacity:queued:global',
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
          );
        });

        it('should use organization-specific key when organizationId provided', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          expect(mockRedisEval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            `capacity:running:${testOrgId}`,
            `capacity:queued:${testOrgId}`,
            expect.any(Number),
            expect.any(Number),
            expect.any(Number)
          );
        });

        it('should use plan-specific capacity limits', async () => {
          mockCheckCapacityLimits.mockResolvedValue({
            runningCapacity: 10,
            queuedCapacity: 100,
          });
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          expect(mockRedisEval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            expect.any(String),
            expect.any(String),
            10,
            100,
            86400
          );
        });
      });

      describe('Negative Cases', () => {
        it('should reject when at capacity', async () => {
          mockRedisEval.mockResolvedValue(0); // 0 = at capacity
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(0);
        });

        it('should fail closed on Redis error', async () => {
          mockRedisEval.mockRejectedValue(new Error('Redis connection failed'));
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(0);
          expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should fail closed on capacity check error', async () => {
          mockCheckCapacityLimits.mockRejectedValue(new Error('Plan not found'));
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(0);
        });
      });

      describe('Security Cases', () => {
        it('should use atomic Lua script for reservation', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          const luaScript = mockRedisEval.mock.calls[0][0];
          expect(luaScript).toContain('KEYS[1]');
          expect(luaScript).toContain('KEYS[2]');
          expect(luaScript).toContain('ARGV[1]');
        });

        it('should set TTL on keys to prevent memory leaks', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          expect(mockRedisEval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            expect.any(String),
            expect.any(String),
            expect.any(Number),
            expect.any(Number),
            86400
          );
        });
      });
    });
  });

  // ==========================================================================
  // QUEUE MANAGEMENT TESTS
  // ==========================================================================

  describe('Queue Management', () => {
    describe('addToQueue', () => {
      const testJobData: QueuedJobData = {
        type: 'playwright',
        jobId: 'job-123',
        runId: 'run-123',
        organizationId: testOrgId,
        projectId: 'project-123',
        taskData: { test: 'data' },
        queuedAt: Date.now(),
      };

      it('should add job to Redis sorted set', async () => {
        const position = await capacityManager.addToQueue(testOrgId, testJobData);
        
        expect(position).toBe(1);
        expect(mockRedisPipeline).toHaveBeenCalled();
      });

      it('should return correct queue position', async () => {
        mockRedisZrank.mockResolvedValue(5);
        
        const position = await capacityManager.addToQueue(testOrgId, testJobData);
        
        expect(position).toBe(6); // 0-indexed rank + 1
      });
    });
  });

  // ==========================================================================
  // SLOT RELEASE TESTS
  // ==========================================================================

  describe('Slot Release', () => {
    describe('releaseRunningSlot', () => {
      it('should decrement running counter', async () => {
        mockRedisDecr.mockResolvedValue(4);
        
        await capacityManager.releaseRunningSlot(testOrgId);
        
        expect(mockRedisDecr).toHaveBeenCalledWith(`capacity:running:${testOrgId}`);
      });

      it('should use global key when no organizationId', async () => {
        mockRedisDecr.mockResolvedValue(4);
        
        await capacityManager.releaseRunningSlot();
        
        expect(mockRedisDecr).toHaveBeenCalledWith('capacity:running:global');
      });

      it('should delete key when counter reaches zero', async () => {
        mockRedisDecr.mockResolvedValue(0);
        
        await capacityManager.releaseRunningSlot(testOrgId);
        
        expect(mockRedisDel).toHaveBeenCalledWith(`capacity:running:${testOrgId}`);
      });

      it('should log error on Redis failure', async () => {
        mockRedisDecr.mockRejectedValue(new Error('Redis error'));
        
        await capacityManager.releaseRunningSlot(testOrgId);
        
        expect(mockLogger.error).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // CAPACITY QUERY TESTS
  // ==========================================================================

  describe('Capacity Queries', () => {
    describe('getCurrentUsage', () => {
      it('should return current usage counts', async () => {
        mockRedisGet.mockResolvedValue('3');
        mockRedisZcard.mockResolvedValue(10);
        
        const result = await capacityManager.getCurrentUsage(testOrgId);
        
        expect(result).toEqual({
          running: 3,
          queued: 10,
          runningCapacity: 5,
          queuedCapacity: 50,
        });
      });

      it('should return zero when no counters exist', async () => {
        mockRedisGet.mockResolvedValue(null);
        mockRedisZcard.mockResolvedValue(0);
        
        const result = await capacityManager.getCurrentUsage(testOrgId);
        
        expect(result.running).toBe(0);
        expect(result.queued).toBe(0);
      });

      it('should use global keys when no organizationId', async () => {
        mockRedisGet.mockResolvedValue('0');
        mockRedisZcard.mockResolvedValue(0);
        
        await capacityManager.getCurrentUsage();
        
        expect(mockRedisGet).toHaveBeenCalledWith('capacity:running:global');
        expect(mockRedisZcard).toHaveBeenCalledWith('capacity:queued:global');
      });

      it('should include plan capacity limits', async () => {
        mockCheckCapacityLimits.mockResolvedValue({
          runningCapacity: 10,
          queuedCapacity: 100,
        });
        mockRedisGet.mockResolvedValue('0');
        mockRedisZcard.mockResolvedValue(0);
        
        const result = await capacityManager.getCurrentUsage(testOrgId);
        
        expect(result.runningCapacity).toBe(10);
        expect(result.queuedCapacity).toBe(100);
      });
    });
  });

  // ==========================================================================
  // COUNTER RESET TESTS
  // ==========================================================================

  describe('Counter Reset', () => {
    describe('resetCounters', () => {
      it('should delete organization-specific keys', async () => {
        // Mock SCAN returning keys
        mockRedisScan.mockResolvedValue(['0', [
          `capacity:running:${testOrgId}`,
          `capacity:queued:${testOrgId}`,
        ]]);
        
        await capacityManager.resetCounters(testOrgId);
        
        expect(mockRedisScan).toHaveBeenCalledWith(
          '0', 'MATCH', `capacity:*:${testOrgId}`, 'COUNT', 100
        );
        expect(mockRedisDel).toHaveBeenCalledWith(
          `capacity:running:${testOrgId}`,
          `capacity:queued:${testOrgId}`
        );
        expect(mockLogger.info).toHaveBeenCalled();
      });

      it('should delete all keys when no organizationId', async () => {
        mockRedisScan.mockResolvedValue(['0', [
          'capacity:running:global',
          'capacity:queued:global',
        ]]);
        
        await capacityManager.resetCounters();
        
        expect(mockRedisScan).toHaveBeenCalledWith(
          '0', 'MATCH', 'capacity:*', 'COUNT', 100
        );
        expect(mockRedisDel).toHaveBeenCalled();
      });

      it('should not call delete when no keys found', async () => {
        mockRedisScan.mockResolvedValue(['0', []]);
        
        await capacityManager.resetCounters(testOrgId);
        
        expect(mockRedisDel).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // JOB ORGANIZATION TRACKING TESTS
  // ==========================================================================

  describe('Job Organization Tracking', () => {
    describe('trackJobOrganization', () => {
      it('should store job-org mapping in Redis', async () => {
        await capacityManager.trackJobOrganization('job-123', testOrgId);
        
        expect(mockRedisSet).toHaveBeenCalledWith(
          'capacity:org:job-123',
          testOrgId,
          'EX',
          expect.any(Number)
        );
      });

      it('should use global when no organizationId', async () => {
        await capacityManager.trackJobOrganization('job-123');
        
        expect(mockRedisSet).toHaveBeenCalledWith(
          'capacity:org:job-123',
          'global',
          'EX',
          expect.any(Number)
        );
      });
    });

    describe('getJobOrganization', () => {
      it('should return stored organization ID', async () => {
        mockRedisGet.mockResolvedValue(testOrgId);
        
        const result = await capacityManager.getJobOrganization('job-123');
        
        expect(result).toBe(testOrgId);
      });

      it('should return undefined when not found', async () => {
        mockRedisGet.mockResolvedValue(null);
        
        const result = await capacityManager.getJobOrganization('job-123');
        
        expect(result).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    describe('Atomic Operations', () => {
      it('should use Lua script for atomic reservation', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot(testOrgId);
        
        const luaScript = mockRedisEval.mock.calls[0][0];
        expect(luaScript).toContain('redis.call');
        expect(luaScript).toContain('INCR');
        expect(luaScript).toContain('GET');
      });
    });

    describe('Fail-Closed Behavior', () => {
      it('should reject reservation on any error', async () => {
        mockRedisEval.mockRejectedValue(new Error('Unknown error'));
        
        const result = await capacityManager.reserveSlot(testOrgId);
        
        expect(result).toBe(0);
      });
    });

    describe('Key Isolation', () => {
      it('should isolate keys by organization', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot('org-1');
        await capacityManager.reserveSlot('org-2');
        
        const calls = mockRedisEval.mock.calls;
        expect(calls[0][2]).toBe('capacity:running:org-1');
        expect(calls[1][2]).toBe('capacity:running:org-2');
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    describe('Organization IDs', () => {
      it('should handle empty organization ID as global', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot('');
        
        // Empty string falls back to 'global' default in the function
        expect(mockRedisEval).toHaveBeenCalledWith(
          expect.any(String),
          2,
          'capacity:running:',
          'capacity:queued:',
          expect.any(Number),
          expect.any(Number),
          expect.any(Number)
        );
      });

      it('should handle special characters in organization ID', async () => {
        const specialId = 'org:with:colons';
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot(specialId);
        
        expect(mockRedisEval).toHaveBeenCalledWith(
          expect.any(String),
          2,
          `capacity:running:${specialId}`,
          `capacity:queued:${specialId}`,
          expect.any(Number),
          expect.any(Number),
          expect.any(Number)
        );
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent slot reservations', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        const promises = Array.from({ length: 10 }, () =>
          capacityManager.reserveSlot(testOrgId)
        );
        
        const results = await Promise.all(promises);
        
        expect(results.every(r => r === 1)).toBe(true);
        expect(mockRedisEval).toHaveBeenCalledTimes(10);
      });

      it('should handle concurrent releases', async () => {
        mockRedisDecr.mockResolvedValue(5);
        
        const promises = Array.from({ length: 10 }, () =>
          capacityManager.releaseRunningSlot(testOrgId)
        );
        
        await Promise.all(promises);
        
        expect(mockRedisDecr).toHaveBeenCalledTimes(10);
      });
    });

    describe('Counter Drift', () => {
      it('should handle negative counter values', async () => {
        mockRedisDecr.mockResolvedValue(-5);
        
        await capacityManager.releaseRunningSlot(testOrgId);
        
        expect(mockRedisDel).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // QUEUE PROCESSOR TESTS
  // ==========================================================================

  describe('Queue Processor', () => {
    describe('startQueueProcessor', () => {
      it('should start processor without error', () => {
        expect(() => capacityManager.startQueueProcessor()).not.toThrow();
        // Clean up
        capacityManager.stopQueueProcessor();
      });

      it('should not start duplicate processors', () => {
        capacityManager.startQueueProcessor();
        capacityManager.startQueueProcessor();
        // Should only log once
        expect(mockLogger.info).toHaveBeenCalledTimes(1);
        // Clean up
        capacityManager.stopQueueProcessor();
      });
    });

    describe('stopQueueProcessor', () => {
      it('should stop processor without error', () => {
        capacityManager.startQueueProcessor();
        expect(() => capacityManager.stopQueueProcessor()).not.toThrow();
        expect(mockLogger.info).toHaveBeenCalledWith({}, 'Stopped capacity queue processor');
      });
    });
  });
});

// ==========================================================================
// RECONCILIATION TESTS
// ==========================================================================
import { reconcileCapacityCounters } from './capacity-manager';

describe('Reconciliation', () => {
  const mockQueue = {
    getJobs: jest.fn(),
    getJobCounts: jest.fn(),
  };

  const mockQueues = {
    playwrightQueues: { global: mockQueue },
    k6Queues: { 'us-east': mockQueue },
  } as unknown as import('./capacity-manager').QueueParameters;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue.getJobs.mockResolvedValue([]);
    mockRedisScan.mockResolvedValue(['0', []]); // Empty scan result
    mockRedisGet.mockResolvedValue(null);
    mockGetRedisConnection.mockResolvedValue(mockRedis);
  });

  it('should detect and fix drift for multiple organizations', async () => {
    // Setup:
    // Org 1: 2 jobs running (Redis says 0) -> Fix to 2
    // Org 2: 0 jobs running (Redis says 5) -> Fix to 0
    // Org 3: 1 job running (Redis says 1) -> No fix

    // Mock active jobs in queues
    mockQueue.getJobs.mockResolvedValueOnce([
      { id: 'job-1', data: { organizationId: 'org-1' } },
      { id: 'job-2', data: { organizationId: 'org-1' } },
    ]).mockResolvedValueOnce([
       { id: 'job-3', data: { organizationId: 'org-3' } },
    ]);

    // Mock Redis content via SCAN (returns [cursor, keys])
    mockRedisScan.mockResolvedValue(['0', [
      'capacity:running:org-1',
      'capacity:running:org-2',
      'capacity:running:org-3',
    ]]);

    mockRedisGet.mockImplementation((key) => {
      if (key === 'capacity:running:org-1') return Promise.resolve('0');
      if (key === 'capacity:running:org-2') return Promise.resolve('5');
      if (key === 'capacity:running:org-3') return Promise.resolve('1');
      return Promise.resolve('0');
    });

    // Run reconciliation
    await reconcileCapacityCounters(mockQueues, true);

    // Expect fixes
    // Org 1: 0 -> 2
    expect(mockRedisSet).toHaveBeenCalledWith(
      'capacity:running:org-1',
      '2',
      expect.any(String),
      expect.any(Number)
    );

    // Org 2: 5 -> 0 (deleted)
    expect(mockRedisDel).toHaveBeenCalledWith('capacity:running:org-2');

    // Org 3: 1 -> 1 (no change)
    expect(mockRedisSet).not.toHaveBeenCalledWith(
      'capacity:running:org-3',
      expect.any(String),
      expect.any(String),
      expect.any(Number)
    );
  });

  it('should gracefully handle empty queues', async () => {
    mockQueue.getJobs.mockResolvedValue([]);
    mockRedisScan.mockResolvedValue(['0', []]);
    
    await reconcileCapacityCounters(mockQueues, true);
    
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
