/**
 * Capacity Manager Tests
 * 
 * Comprehensive test coverage for Redis-based atomic capacity management
 * 
 * Test Categories:
 * - Slot Reservation (running/queued capacity)
 * - Slot Release (job completion/failure)
 * - State Transitions (queued to running)
 * - Capacity Queries (current usage)
 * - Security (atomic operations, race conditions)
 * - Edge Cases (counter drift, recovery)
 */

// Mock plan enforcement first
jest.mock('./middleware/plan-enforcement', () => ({
  checkCapacityLimits: jest.fn(),
}));

// Mock queue logger
jest.mock('./queue', () => ({
  queueLogger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
  getRedisConnection: jest.fn(),
  getQueues: jest.fn(),
}));

import { CapacityManager } from './capacity-manager';

// Mock Redis
const mockRedisEval = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisDecr = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisKeys = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisPipeline = jest.fn();

const mockRedis: Partial<typeof import('ioredis').default.prototype> = {
  eval: mockRedisEval,
  get: mockRedisGet,
  incr: mockRedisIncr,
  decr: mockRedisDecr,
  del: mockRedisDel,
  keys: mockRedisKeys,
  expire: mockRedisExpire,
  pipeline: mockRedisPipeline,
};

import { checkCapacityLimits } from './middleware/plan-enforcement';
import { queueLogger } from './queue';

const mockCheckCapacityLimits = checkCapacityLimits as jest.Mock;
const mockQueueLogger = queueLogger as jest.Mocked<typeof queueLogger>;

describe('CapacityManager', () => {
  let capacityManager: CapacityManager;

  const testOrgId = 'org-test-123';
  
  const defaultCapacityLimits = {
    runningCapacity: 5,
    queuedCapacity: 50,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    capacityManager = new CapacityManager(mockRedis as jest.Mocked<import('ioredis').default>);
    
    // Default mock implementations
    mockCheckCapacityLimits.mockResolvedValue(defaultCapacityLimits);
    mockRedisGet.mockResolvedValue(null);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisDecr.mockResolvedValue(0);
    mockRedisDel.mockResolvedValue(1);
    mockRedisKeys.mockResolvedValue([]);
    mockRedisExpire.mockResolvedValue(1);
    
    // Default pipeline mock
    const mockPipelineInstance = {
      decr: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1]]),
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
          
          expect(result).toBe(true);
          expect(mockRedisEval).toHaveBeenCalled();
        });

        it('should reserve slot when must wait in queue', async () => {
          mockRedisEval.mockResolvedValue(2); // 2 = must wait in queue
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(true);
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
          
          expect(result).toBe(false);
        });

        it('should fail closed on Redis error', async () => {
          mockRedisEval.mockRejectedValue(new Error('Redis connection failed'));
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(false);
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });

        it('should fail closed on capacity check error', async () => {
          mockCheckCapacityLimits.mockRejectedValue(new Error('Plan not found'));
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(false);
        });
      });

      describe('Security Cases', () => {
        it('should use atomic Lua script for reservation', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          // Verify Lua script is passed (contains KEYS and ARGV references)
          const luaScript = mockRedisEval.mock.calls[0][0];
          expect(luaScript).toContain('KEYS[1]');
          expect(luaScript).toContain('KEYS[2]');
          expect(luaScript).toContain('ARGV[1]');
        });

        it('should set TTL on keys to prevent memory leaks', async () => {
          mockRedisEval.mockResolvedValue(1);
          
          await capacityManager.reserveSlot(testOrgId);
          
          // Verify TTL is passed (86400 = 24 hours)
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

      describe('Boundary Cases', () => {
        it('should handle zero capacity limits', async () => {
          mockCheckCapacityLimits.mockResolvedValue({
            runningCapacity: 0,
            queuedCapacity: 0,
          });
          mockRedisEval.mockResolvedValue(0);
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(false);
        });

        it('should handle very large capacity limits', async () => {
          mockCheckCapacityLimits.mockResolvedValue({
            runningCapacity: 9999,
            queuedCapacity: 99999,
          });
          mockRedisEval.mockResolvedValue(1);
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(true);
        });
      });
    });
  });

  // ==========================================================================
  // SLOT RELEASE TESTS
  // ==========================================================================

  describe('Slot Release', () => {
    describe('releaseRunningSlot', () => {
      describe('Positive Cases', () => {
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

        it('should delete key when counter goes negative', async () => {
          mockRedisDecr.mockResolvedValue(-1);
          
          await capacityManager.releaseRunningSlot(testOrgId);
          
          expect(mockRedisDel).toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should log error on Redis failure', async () => {
          mockRedisDecr.mockRejectedValue(new Error('Redis error'));
          
          await capacityManager.releaseRunningSlot(testOrgId);
          
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });
      });
    });

    describe('releaseQueuedSlot', () => {
      describe('Positive Cases', () => {
        it('should decrement queued counter', async () => {
          mockRedisDecr.mockResolvedValue(4);
          
          await capacityManager.releaseQueuedSlot(testOrgId);
          
          expect(mockRedisDecr).toHaveBeenCalledWith(`capacity:queued:${testOrgId}`);
        });

        it('should use global key when no organizationId', async () => {
          mockRedisDecr.mockResolvedValue(4);
          
          await capacityManager.releaseQueuedSlot();
          
          expect(mockRedisDecr).toHaveBeenCalledWith('capacity:queued:global');
        });

        it('should delete key when counter reaches zero', async () => {
          mockRedisDecr.mockResolvedValue(0);
          
          await capacityManager.releaseQueuedSlot(testOrgId);
          
          expect(mockRedisDel).toHaveBeenCalledWith(`capacity:queued:${testOrgId}`);
        });
      });

      describe('Negative Cases', () => {
        it('should log error on Redis failure', async () => {
          mockRedisDecr.mockRejectedValue(new Error('Redis error'));
          
          await capacityManager.releaseQueuedSlot(testOrgId);
          
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });
      });
    });
  });

  // ==========================================================================
  // STATE TRANSITION TESTS
  // ==========================================================================

  describe('State Transitions', () => {
    describe('transitionQueuedToRunning', () => {
      describe('Positive Cases', () => {
        it('should atomically decrement queued and increment running', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[null, 4], [null, 2], [null, 1]]),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          expect(mockPipelineInstance.decr).toHaveBeenCalledWith(`capacity:queued:${testOrgId}`);
          expect(mockPipelineInstance.incr).toHaveBeenCalledWith(`capacity:running:${testOrgId}`);
          expect(mockPipelineInstance.exec).toHaveBeenCalled();
        });

        it('should refresh TTL on running key', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[null, 4], [null, 2], [null, 1]]),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          expect(mockPipelineInstance.expire).toHaveBeenCalledWith(
            `capacity:running:${testOrgId}`,
            86400
          );
        });

        it('should use global keys when no organizationId', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[null, 4], [null, 2], [null, 1]]),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning();
          
          expect(mockPipelineInstance.decr).toHaveBeenCalledWith('capacity:queued:global');
          expect(mockPipelineInstance.incr).toHaveBeenCalledWith('capacity:running:global');
        });

        it('should clean up queued key if it reaches zero', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1]]),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          expect(mockRedisDel).toHaveBeenCalledWith(`capacity:queued:${testOrgId}`);
        });
      });

      describe('Negative Cases', () => {
        it('should log error on pipeline failure', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockRejectedValue(new Error('Pipeline error')),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });
      });

      describe('Edge Cases', () => {
        it('should handle null pipeline results', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          // Should not throw
          expect(mockRedisDel).not.toHaveBeenCalled();
        });

        it('should handle empty pipeline results', async () => {
          const mockPipelineInstance = {
            decr: jest.fn().mockReturnThis(),
            incr: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([]),
          };
          mockRedisPipeline.mockReturnValue(mockPipelineInstance);
          
          await capacityManager.transitionQueuedToRunning(testOrgId);
          
          expect(mockRedisDel).not.toHaveBeenCalled();
        });
      });
    });
  });

  // ==========================================================================
  // CAPACITY QUERY TESTS
  // ==========================================================================

  describe('Capacity Queries', () => {
    describe('getCurrentUsage', () => {
      describe('Positive Cases', () => {
        it('should return current usage counts', async () => {
          mockRedisGet
            .mockResolvedValueOnce('3') // running
            .mockResolvedValueOnce('10'); // queued
          
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
          
          const result = await capacityManager.getCurrentUsage(testOrgId);
          
          expect(result.running).toBe(0);
          expect(result.queued).toBe(0);
        });

        it('should use global keys when no organizationId', async () => {
          mockRedisGet.mockResolvedValue('0');
          
          await capacityManager.getCurrentUsage();
          
          expect(mockRedisGet).toHaveBeenCalledWith('capacity:running:global');
          expect(mockRedisGet).toHaveBeenCalledWith('capacity:queued:global');
        });

        it('should include plan capacity limits', async () => {
          mockCheckCapacityLimits.mockResolvedValue({
            runningCapacity: 10,
            queuedCapacity: 100,
          });
          mockRedisGet.mockResolvedValue('0');
          
          const result = await capacityManager.getCurrentUsage(testOrgId);
          
          expect(result.runningCapacity).toBe(10);
          expect(result.queuedCapacity).toBe(100);
        });
      });

      describe('Negative Cases', () => {
        it('should return zeros on Redis error', async () => {
          mockRedisGet.mockRejectedValue(new Error('Redis error'));
          
          const result = await capacityManager.getCurrentUsage(testOrgId);
          
          expect(result.running).toBe(0);
          expect(result.queued).toBe(0);
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });
      });

      describe('Boundary Cases', () => {
        it('should handle very large counter values', async () => {
          mockRedisGet
            .mockResolvedValueOnce('999999')
            .mockResolvedValueOnce('9999999');
          
          const result = await capacityManager.getCurrentUsage(testOrgId);
          
          expect(result.running).toBe(999999);
          expect(result.queued).toBe(9999999);
        });

        it('should handle non-numeric counter values', async () => {
          mockRedisGet
            .mockResolvedValueOnce('invalid')
            .mockResolvedValueOnce('NaN');
          
          const result = await capacityManager.getCurrentUsage(testOrgId);
          
          expect(result.running).toBe(NaN);
          expect(result.queued).toBe(NaN);
        });
      });
    });
  });

  // ==========================================================================
  // COUNTER RESET TESTS
  // ==========================================================================

  describe('Counter Reset', () => {
    describe('resetCounters', () => {
      describe('Positive Cases', () => {
        it('should delete organization-specific keys', async () => {
          mockRedisKeys.mockResolvedValue([
            `capacity:running:${testOrgId}`,
            `capacity:queued:${testOrgId}`,
          ]);
          
          await capacityManager.resetCounters(testOrgId);
          
          expect(mockRedisKeys).toHaveBeenCalledWith(`capacity:*:${testOrgId}`);
          expect(mockRedisDel).toHaveBeenCalledWith(
            `capacity:running:${testOrgId}`,
            `capacity:queued:${testOrgId}`
          );
          expect(mockQueueLogger.info).toHaveBeenCalled();
        });

        it('should delete all keys when no organizationId', async () => {
          mockRedisKeys.mockResolvedValue([
            'capacity:running:global',
            'capacity:queued:global',
          ]);
          
          await capacityManager.resetCounters();
          
          expect(mockRedisKeys).toHaveBeenCalledWith('capacity:*');
          expect(mockRedisDel).toHaveBeenCalled();
        });

        it('should not call delete when no keys found', async () => {
          mockRedisKeys.mockResolvedValue([]);
          
          await capacityManager.resetCounters(testOrgId);
          
          expect(mockRedisDel).not.toHaveBeenCalled();
        });
      });

      describe('Negative Cases', () => {
        it('should log error on keys lookup failure', async () => {
          mockRedisKeys.mockRejectedValue(new Error('Redis error'));
          
          await capacityManager.resetCounters(testOrgId);
          
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });

        it('should log error on delete failure', async () => {
          mockRedisKeys.mockResolvedValue(['capacity:running:test']);
          mockRedisDel.mockRejectedValue(new Error('Delete failed'));
          
          await capacityManager.resetCounters(testOrgId);
          
          expect(mockQueueLogger.error).toHaveBeenCalled();
        });
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

      it('should use pipeline for atomic transitions', async () => {
        const mockPipelineInstance = {
          decr: jest.fn().mockReturnThis(),
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1]]),
        };
        mockRedisPipeline.mockReturnValue(mockPipelineInstance);
        
        await capacityManager.transitionQueuedToRunning(testOrgId);
        
        expect(mockRedisPipeline).toHaveBeenCalled();
        expect(mockPipelineInstance.exec).toHaveBeenCalled();
      });
    });

    describe('Fail-Closed Behavior', () => {
      it('should reject reservation on any error', async () => {
        mockRedisEval.mockRejectedValue(new Error('Unknown error'));
        
        const result = await capacityManager.reserveSlot(testOrgId);
        
        expect(result).toBe(false);
      });

      it('should reject reservation on timeout', async () => {
        mockRedisEval.mockRejectedValue(new Error('Command timeout'));
        
        const result = await capacityManager.reserveSlot(testOrgId);
        
        expect(result).toBe(false);
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

      it('should prevent cross-organization access', async () => {
        mockRedisGet
          .mockResolvedValueOnce('5')
          .mockResolvedValueOnce('10');

        await capacityManager.getCurrentUsage('org-1');

        expect(mockRedisGet).toHaveBeenCalledWith('capacity:running:org-1');
        expect(mockRedisGet).not.toHaveBeenCalledWith('capacity:running:org-2');
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
        
        // Empty string is falsy, so it falls back to global
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

      it('should handle very long organization ID', async () => {
        const longId = 'a'.repeat(500);
        mockRedisEval.mockResolvedValue(1);
        
        const result = await capacityManager.reserveSlot(longId);
        
        expect(result).toBe(true);
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent slot reservations', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        const promises = Array.from({ length: 10 }, () =>
          capacityManager.reserveSlot(testOrgId)
        );
        
        const results = await Promise.all(promises);
        
        expect(results.every(r => r === true)).toBe(true);
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

      it('should handle inconsistent pipeline results', async () => {
        const mockPipelineInstance = {
          decr: jest.fn().mockReturnThis(),
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[new Error('error'), null]]),
        };
        mockRedisPipeline.mockReturnValue(mockPipelineInstance);
        
        await capacityManager.transitionQueuedToRunning(testOrgId);
        
        // Should not throw
        expect(mockRedisDel).not.toHaveBeenCalled();
      });
    });

    describe('TTL Management', () => {
      it('should set 24-hour TTL on capacity keys', async () => {
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot(testOrgId);
        
        expect(mockRedisEval).toHaveBeenCalledWith(
          expect.any(String),
          2,
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          expect.any(Number),
          86400 // 24 hours in seconds
        );
      });
    });
  });

  // ==========================================================================
  // INTEGRATION-LIKE TESTS
  // ==========================================================================

  describe('Workflow Tests', () => {
    describe('Complete Job Lifecycle', () => {
      it('should handle reserve -> transition -> release workflow', async () => {
        // Reserve slot
        mockRedisEval.mockResolvedValue(2); // queued
        const reserved = await capacityManager.reserveSlot(testOrgId);
        expect(reserved).toBe(true);

        // Transition to running
        const mockPipelineInstance = {
          decr: jest.fn().mockReturnThis(),
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1]]),
        };
        mockRedisPipeline.mockReturnValue(mockPipelineInstance);
        await capacityManager.transitionQueuedToRunning(testOrgId);
        expect(mockPipelineInstance.exec).toHaveBeenCalled();

        // Release running slot
        mockRedisDecr.mockResolvedValue(0);
        await capacityManager.releaseRunningSlot(testOrgId);
        expect(mockRedisDecr).toHaveBeenCalled();
      });

      it('should handle reserve -> fail before running workflow', async () => {
        // Reserve slot
        mockRedisEval.mockResolvedValue(2); // queued
        const reserved = await capacityManager.reserveSlot(testOrgId);
        expect(reserved).toBe(true);

        // Job fails before becoming active - release queued slot
        mockRedisDecr.mockResolvedValue(0);
        await capacityManager.releaseQueuedSlot(testOrgId);
        expect(mockRedisDecr).toHaveBeenCalledWith(`capacity:queued:${testOrgId}`);
      });
    });

    describe('Capacity Check Workflow', () => {
      it('should check capacity before reservation', async () => {
        mockCheckCapacityLimits.mockResolvedValue({
          runningCapacity: 5,
          queuedCapacity: 50,
        });
        mockRedisEval.mockResolvedValue(1);
        
        await capacityManager.reserveSlot(testOrgId);
        
        expect(mockCheckCapacityLimits).toHaveBeenCalledWith(testOrgId);
      });

      it('should use capacity limits in reservation decision', async () => {
        mockCheckCapacityLimits.mockResolvedValue({
          runningCapacity: 1,
          queuedCapacity: 1,
        });
        mockRedisEval.mockResolvedValue(0); // at capacity
        
        const result = await capacityManager.reserveSlot(testOrgId);
        
        expect(result).toBe(false);
      });
    });
  });
});
