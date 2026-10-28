jest.mock("@/utils/db", () => ({ db: { update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })) })) } }));
jest.mock("./execution/execution-policy", () => ({ getExecutionPolicy: jest.fn().mockResolvedValue({ tier: "paid", priority: 0 }), assertExecutionWorkload: jest.fn().mockResolvedValue(undefined), ExecutionWorkloadError: class ExecutionWorkloadError extends Error { constructor(message: string, readonly status: 400 | 402 = 400, readonly inFlightOnly = false) { super(message); } } }));
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

import { CapacityManager, CapacityReservationUnavailableError, QueuedJobData, setCapacityLogger } from './capacity-manager';
import { checkCapacityLimits } from './middleware/plan-enforcement';
import { getExecutionPolicy, assertExecutionWorkload, ExecutionWorkloadError } from './execution/execution-policy';
import { getQueues } from './queue';
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

const mockRedis: Record<string, unknown> = {
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
  status: 'ready',
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
    mockRedis.status = 'ready';
    capacityManager = new CapacityManager(mockRedis as unknown as import('ioredis').default);
    
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

  describe('promotion preflight', () => {
    const queued: QueuedJobData = { type: 'playwright', jobId: 'waiting-job', runId: 'waiting-run',
      organizationId: 'org-test-123', projectId: 'project', taskData: { code: 'test()' }, queuedAt: 1234 };

    it.each(['policy', 'workload'])('keeps the queue payload and capacity untouched on a temporary %s failure', async phase => {
      mockRedisGet.mockResolvedValue(JSON.stringify(queued));
      mockRedisEval.mockResolvedValue(1);
      const cleanup = jest.spyOn(capacityManager as never, 'cleanupJobData' as never);
      if (phase === 'policy') jest.mocked(getExecutionPolicy).mockRejectedValueOnce(new Error('database unavailable'));
      else jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('DNS unavailable', 503 as never));
      const { db } = jest.requireMock('@/utils/db');
      expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
      expect(mockRedisEval).not.toHaveBeenCalled();
      expect(mockRedisZrem).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    describe('a queued job that keeps failing to promote', () => {
      const failureKey = `capacity:promote-failures:${queued.jobId}`;
      const queuedKeyFor = expect.stringContaining(testOrgId);

      it.each([
        ['an error', () => jest.mocked(getExecutionPolicy).mockRejectedValue(new Error('database unavailable'))],
        ['a DNS outage', () => jest.mocked(assertExecutionWorkload).mockRejectedValue(new ExecutionWorkloadError('DNS unavailable', 503 as never))],
      ])('steps behind the others after three failures (%s), and its run is never failed', async (_name, fail) => {
        mockRedisGet.mockResolvedValue(JSON.stringify(queued));
        fail();
        const { db } = jest.requireMock('@/utils/db');
        for (const count of [1, 2, 3]) {
          mockRedisIncr.mockResolvedValueOnce(count);
          expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
        }
        expect(mockRedisIncr).toHaveBeenCalledWith(failureKey);
        // Only the third failure moves it, and only if it is still queued (XX), to the back of the queue.
        expect(mockRedisZadd).toHaveBeenCalledTimes(1);
        expect(mockRedisZadd).toHaveBeenCalledWith(queuedKeyFor, 'XX', expect.any(Number), queued.jobId);
        expect(mockRedisZrem).not.toHaveBeenCalled();
        expect(db.update).not.toHaveBeenCalled();
        jest.mocked(getExecutionPolicy).mockReset().mockResolvedValue({ tier: 'paid', priority: 0 } as never);
        jest.mocked(assertExecutionWorkload).mockReset().mockResolvedValue(undefined);
      });

      it('keeps stepping aside every third failure, not just once', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify(queued));
        jest.mocked(getExecutionPolicy).mockRejectedValue(new Error('database unavailable'));
        for (let count = 1; count <= 6; count += 1) {
          mockRedisIncr.mockResolvedValueOnce(count);
          await capacityManager['promoteJob'](testOrgId, queued.jobId);
        }
        expect(mockRedisZadd).toHaveBeenCalledTimes(2);
        jest.mocked(getExecutionPolicy).mockReset().mockResolvedValue({ tier: 'paid', priority: 0 } as never);
      });

      it('does not count a permanent rejection or a lost race', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify(queued));
        jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('target not verified', 400));
        await capacityManager['promoteJob'](testOrgId, queued.jobId);
        expect(mockRedisIncr).not.toHaveBeenCalled();
      });

      it('forgets the count once the job is promoted', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify(queued));
        mockRedisEval.mockResolvedValue(1);
        jest.spyOn(capacityManager as never, 'addJobToBullMQ' as never).mockResolvedValue(undefined as never);
        expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(true);
        expect(mockRedisDel).toHaveBeenCalledWith(failureKey);
      });

      it('clears the count together with the rest of the job data', async () => {
        await capacityManager['cleanupJobData'](queued.jobId);
        const deleted = mockRedisPipeline.mock.results.flatMap((result) => (result.value as { del: jest.Mock }).del.mock.calls.map(([key]) => key as string));
        expect(deleted).toContain(failureKey);
      });

      it('does not let a failure to record the count break the queue pass', async () => {
        mockRedisGet.mockResolvedValue(JSON.stringify(queued));
        jest.mocked(getExecutionPolicy).mockRejectedValueOnce(new Error('database unavailable'));
        mockRedisIncr.mockRejectedValueOnce(new Error('redis down'));
        await expect(capacityManager['promoteJob'](testOrgId, queued.jobId)).resolves.toBe(false);
      });
    });

    describe('a queued job whose payload cannot be read', () => {
      it('is failed and dropped instead of holding the head of the queue forever', async () => {
        mockRedisGet.mockResolvedValue('{"type": not json');
        const { db } = jest.requireMock('@/utils/db');
        expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
        expect(getExecutionPolicy).not.toHaveBeenCalledWith(expect.anything());
        expect(mockRedisZrem).toHaveBeenCalledWith(expect.stringContaining(testOrgId), queued.jobId);
        expect(db.update).toHaveBeenCalled();
        expect(mockRedisEval).not.toHaveBeenCalled();
      });

      it('fails the run when the payload is missing, instead of leaving it queued forever', async () => {
        mockRedisGet.mockResolvedValue(null);
        const { db } = jest.requireMock('@/utils/db');
        db.update.mockClear();
        expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
        expect(db.update).toHaveBeenCalled();
      });

      it('is left alone when another promoter already removed it', async () => {
        mockRedisGet.mockResolvedValue('not json');
        mockRedisZrem.mockResolvedValueOnce(0);
        const { db } = jest.requireMock('@/utils/db');
        expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
        expect(db.update).not.toHaveBeenCalled();
      });

      it('goes back in the queue if its run cannot be marked failed, so it is retried', async () => {
        mockRedisGet.mockResolvedValue('not json');
        const { db } = jest.requireMock('@/utils/db');
        db.update.mockImplementationOnce(() => ({ set: () => ({ where: () => Promise.reject(new Error('database unavailable')) }) }));
        expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
        expect(mockRedisZadd).toHaveBeenCalledWith(expect.stringContaining(testOrgId), expect.any(Number), queued.jobId);
      });
    });

    it('rejects a permanently invalid workload without claiming execution capacity', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(queued));
      mockRedisEval.mockResolvedValue(1);
      jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('target not verified', 400));
      const { db } = jest.requireMock('@/utils/db');
      expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
      expect(mockRedisEval).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(mockRedisZrem).toHaveBeenCalledWith(expect.stringContaining(testOrgId), queued.jobId);
    });

    it('keeps a run queued when only in-flight reservations push it over the trial allowance', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(queued));
      jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('quota', 402, true));
      const { db } = jest.requireMock('@/utils/db');
      db.update.mockClear();
      expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
      expect(mockRedisEval).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(mockRedisZrem).not.toHaveBeenCalled();
    });

    it('leaves a rejected workload queued if recording its terminal status fails', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(queued));
      jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('expired', 402));
      const { db } = jest.requireMock('@/utils/db');
      db.update.mockImplementationOnce(() => ({ set: () => ({ where: () => Promise.reject(new Error('database unavailable')) }) }));
      expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
      expect(mockRedisEval).not.toHaveBeenCalled();
      expect(mockRedisZadd).toHaveBeenCalledWith(expect.stringContaining(testOrgId), queued.queuedAt, queued.jobId);
    });

    it('cannot reject a queued run another promoter already claimed', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(queued));
      mockRedisZrem.mockResolvedValueOnce(0);
      jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('target revoked', 400));
      const { db } = jest.requireMock('@/utils/db');
      expect(await capacityManager['promoteJob'](testOrgId, queued.jobId)).toBe(false);
      expect(db.update).not.toHaveBeenCalled();
      expect(mockRedisEval).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // SLOT RESERVATION TESTS
  // ==========================================================================

  describe('Slot Reservation', () => {
    it('refreshes the trusted tier when a queued execution is promoted', async () => {
    const add = jest.fn().mockResolvedValue({});
    jest.mocked(getExecutionPolicy).mockResolvedValueOnce({ tier: 'trial', priority: 1, runningCapacity: 1, queuedCapacity: 10, expiresAt: new Date(Date.now() + 60_000), k6MaxVus: 5, k6RemainingVuMs: 9_000_000, playwrightRemainingMs: 1000 });
    jest.mocked(getQueues).mockResolvedValueOnce({ playwrightQueues: { global: { add } } } as unknown as Awaited<ReturnType<typeof getQueues>>);
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ type: 'playwright', jobId: 'promoted', runId: 'promoted', organizationId: testOrgId, projectId: 'project', taskData: { _executionTier: 'paid' }, queuedAt: Date.now() }));
    mockRedisEval.mockResolvedValueOnce(1);
    expect(await capacityManager['promoteJob'](testOrgId, 'promoted')).toBe(true);
    expect(add).toHaveBeenCalledWith('promoted', expect.objectContaining({ _executionTier: 'trial' }), { jobId: 'promoted', priority: 1 });
    expect(getExecutionPolicy).toHaveBeenCalledWith(testOrgId);
  });

  it('keeps a promoted run queued, not failed, when a DNS outage stops its workload check', async () => {
    jest.mocked(assertExecutionWorkload).mockRejectedValueOnce(new ExecutionWorkloadError('DNS verification is temporarily unavailable', 503 as never));
    mockRedisZadd.mockClear();
    const queuedAt = Date.now() - 5000;
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ type: 'k6', jobId: 'dns-job', runId: 'dns-run', organizationId: testOrgId, projectId: 'project', taskData: { script: 's' }, queuedAt }));
    expect(await capacityManager['promoteJob'](testOrgId, 'dns-job')).toBe(false);
    expect(mockRedisEval).not.toHaveBeenCalled();
    const { db } = jest.requireMock('@/utils/db') as { db: { update: jest.Mock } };
    expect(db.update).not.toHaveBeenCalled();
  });

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
            expect.any(Number),
            expect.any(String),
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
            expect.any(Number),
            expect.any(String),
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
            86400,
            expect.any(String),
            expect.any(Number)
          );
        });
      });

      describe('Negative Cases', () => {
        it('should reject when at capacity', async () => {
          mockRedisEval.mockResolvedValue(0); // 0 = at capacity
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(0);
        });

        it('should fail closed on non-transient Redis error', async () => {
          mockRedisEval.mockRejectedValue(new Error('Redis connection failed'));
          
          await expect(
            capacityManager.reserveSlot(testOrgId)
          ).rejects.toBeInstanceOf(CapacityReservationUnavailableError);
          expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should fail closed after retries on transient Redis error (ECONNREFUSED)', async () => {
          mockRedisEval.mockRejectedValue(new Error('connect ECONNREFUSED 10.43.0.1:6379'));
          
          await expect(
            capacityManager.reserveSlot(testOrgId)
          ).rejects.toBeInstanceOf(CapacityReservationUnavailableError);
          // Should have retried 3 times (3 calls to eval)
          expect(mockRedisEval).toHaveBeenCalledTimes(3);
          expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should fail closed after retries on transient Redis error (READONLY)', async () => {
          mockRedisEval.mockRejectedValue(new Error('READONLY You can\'t write against a read only replica'));
          
          await expect(
            capacityManager.reserveSlot(testOrgId)
          ).rejects.toBeInstanceOf(CapacityReservationUnavailableError);
          expect(mockRedisEval).toHaveBeenCalledTimes(3);
        });

        it('should succeed on retry when transient error resolves', async () => {
          mockRedisEval
            .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.43.0.1:6379'))
            .mockResolvedValueOnce(1); // Second attempt succeeds
          
          const result = await capacityManager.reserveSlot(testOrgId);
          
          expect(result).toBe(1);
          expect(mockRedisEval).toHaveBeenCalledTimes(2);
        });

        it('should fail closed on capacity check error', async () => {
          mockCheckCapacityLimits.mockRejectedValue(new Error('Plan not found'));
          
          await expect(
            capacityManager.reserveSlot(testOrgId)
          ).rejects.toBeInstanceOf(CapacityReservationUnavailableError);
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
            86400,
            expect.any(String),
            expect.any(Number)
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

    // Cancellation uses this to learn whether a run is still waiting. "Could not check" must never look like
    // "not waiting", or a run that is still queued would be finalized on a guess.
    describe('removeFromQueuedSet', () => {
      it('removes a waiting job together with its payload and reports it', async () => {
        mockRedisZrem.mockResolvedValue(1);
        await expect(capacityManager.removeFromQueuedSet(testOrgId, 'job-1')).resolves.toBe(true);
        expect(mockRedisZrem).toHaveBeenCalledWith(expect.stringContaining(testOrgId), 'job-1');
        expect(mockRedisPipeline).toHaveBeenCalled(); // payload cleanup
      });

      it('reports false, without touching the payload, when the job is not queued', async () => {
        mockRedisZrem.mockResolvedValue(0);
        await expect(capacityManager.removeFromQueuedSet(testOrgId, 'job-1')).resolves.toBe(false);
        expect(mockRedisPipeline).not.toHaveBeenCalled();
      });

      it('rethrows when Redis cannot be reached instead of answering that the job was not queued', async () => {
        const outage = new Error('redis unavailable');
        mockRedisZrem.mockRejectedValue(outage);
        await expect(capacityManager.removeFromQueuedSet(testOrgId, 'job-1')).rejects.toBe(outage);
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

  describe('processQueuedJobs with an ended entitlement', () => {
    const queuedKey = `capacity:queued:${testOrgId}`;
    const expired = () => new ExecutionWorkloadError('Execution entitlement required or trial expired', 402);

    beforeEach(() => {
      mockRedisScan.mockResolvedValue(['0', [queuedKey]]);
      mockCheckCapacityLimits.mockRejectedValue(expired());
    });

    it('removes queued jobs, clears their data and marks the runs failed', async () => {
      const { db } = jest.requireMock('@/utils/db');
      const where = jest.fn().mockResolvedValue(undefined);
      const set = jest.fn(() => ({ where }));
      db.update.mockReturnValue({ set });
      mockRedisZrange.mockResolvedValue(['job-1', 'job-2']);
      mockRedisZrem.mockResolvedValue(1);
      mockRedisGet.mockImplementation(async (key: string) =>
        key === 'capacity:job:job-1' ? JSON.stringify({ runId: 'run-1' }) : null);
      const pipelineDel = jest.fn().mockReturnThis();
      mockRedisPipeline.mockReturnValue({ del: pipelineDel, exec: jest.fn().mockResolvedValue([]) });

      await capacityManager.processQueuedJobs();

      expect(mockRedisZrem).toHaveBeenCalledWith(queuedKey, 'job-1');
      expect(mockRedisZrem).toHaveBeenCalledWith(queuedKey, 'job-2');
      expect(pipelineDel).toHaveBeenCalledWith('capacity:job:job-1');
      expect(pipelineDel).toHaveBeenCalledWith('capacity:job:job-2');
      expect(set).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('puts the entry back and keeps its data when the run cannot be updated, so the next pass retries', async () => {
      const { db } = jest.requireMock('@/utils/db');
      db.update.mockReturnValue({ set: jest.fn(() => ({ where: jest.fn().mockRejectedValue(new Error('db down')) })) });
      mockRedisZrange.mockResolvedValue(['job-1']);
      mockRedisZrem.mockResolvedValue(1);
      mockRedisZadd.mockClear();
      mockRedisGet.mockResolvedValue(JSON.stringify({ runId: 'run-1' }));
      const pipelineDel = jest.fn().mockReturnThis();
      mockRedisPipeline.mockReturnValue({ del: pipelineDel, exec: jest.fn().mockResolvedValue([]) });
      await capacityManager.processQueuedJobs();
      expect(mockRedisZadd).toHaveBeenCalledWith(queuedKey, expect.any(Number), 'job-1');
      expect(pipelineDel).not.toHaveBeenCalled();
    });

    it('still fails the run, and the rest of the queue, when one job payload is unreadable', async () => {
      const { db } = jest.requireMock('@/utils/db');
      const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
      db.update.mockReturnValue({ set });
      mockRedisZrange.mockResolvedValue(['bad', 'job-2']);
      mockRedisZrem.mockResolvedValue(1);
      mockRedisGet.mockImplementation(async (key: string) => (key.endsWith('bad') ? '{not json' : JSON.stringify({ runId: 'run-2' })));
      mockRedisPipeline.mockReturnValue({ del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
      await capacityManager.processQueuedJobs();
      expect(set).toHaveBeenCalledTimes(2);
    });

    it('skips a job another worker already removed', async () => {
      const { db } = jest.requireMock('@/utils/db');
      db.update.mockClear();
      mockRedisZrange.mockResolvedValue(['job-1']);
      mockRedisZrem.mockResolvedValue(0);
      await capacityManager.processQueuedJobs();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('keeps processing other organizations after failing one', async () => {
      mockRedisScan.mockResolvedValue(['0', [queuedKey, 'capacity:queued:org-other']]);
      mockCheckCapacityLimits
        .mockRejectedValueOnce(expired())
        .mockResolvedValueOnce(defaultCapacityLimits);
      mockRedisZrange.mockResolvedValue([]);
      await capacityManager.processQueuedJobs();
      expect(mockCheckCapacityLimits).toHaveBeenCalledWith('org-other');
    });

    it('leaves queued jobs untouched on an operational failure so the next cycle retries', async () => {
      mockCheckCapacityLimits.mockRejectedValue(new Error('database unavailable'));
      await capacityManager.processQueuedJobs();
      expect(mockRedisZrem).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

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
        
        await expect(
          capacityManager.reserveSlot(testOrgId)
        ).rejects.toBeInstanceOf(CapacityReservationUnavailableError);
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
          expect.any(Number),
          expect.any(String),
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
          expect.any(Number),
          expect.any(String),
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

    describe('Connection Recovery', () => {
      it('should refresh dead Redis connection when status is end', async () => {
        mockRedisEval.mockResolvedValue(1);
        // Simulate dead connection (e.g. after quit() or ioredis gave up)
        mockRedis.status = 'end';

        const result = await capacityManager.reserveSlot(testOrgId);

        expect(result).toBe(1);
        // Should have called getRedisConnection to get a fresh connection
        expect(mockGetRedisConnection).toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          {},
          "CapacityManager Redis connection is dead, refreshing"
        );
      });

      it('should not refresh connection when status is ready', async () => {
        mockRedisEval.mockResolvedValue(1);
        mockRedis.status = 'ready';

        await capacityManager.reserveSlot(testOrgId);

        // Should NOT call getRedisConnection - connection is fine
        expect(mockGetRedisConnection).not.toHaveBeenCalled();
      });

      it('should not refresh connection when status is reconnecting', async () => {
        mockRedisEval.mockResolvedValue(1);
        mockRedis.status = 'reconnecting';

        await capacityManager.reserveSlot(testOrgId);

        // ioredis handles reconnection internally - should not refresh
        expect(mockGetRedisConnection).not.toHaveBeenCalled();
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

    // Run reconciliation: a drift is corrected once the next pass confirms it.
    const arm = () => mockQueue.getJobs.mockResolvedValueOnce([
      { id: 'job-1', data: { organizationId: 'org-1' } },
      { id: 'job-2', data: { organizationId: 'org-1' } },
    ]).mockResolvedValueOnce([
      { id: 'job-3', data: { organizationId: 'org-3' } },
    ]);
    await reconcileCapacityCounters(mockQueues, true);
    arm();
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

  it('only corrects a drift that is still there on the next pass', async () => {
    // A single pass compares a BullMQ snapshot with a later Redis read, so a job admitted or finished in
    // between looks like drift. Dropping its slot would let the org over-admit.
    mockQueue.getJobs.mockResolvedValue([{ id: 'j', data: { organizationId: 'org-race' } }]);
    mockRedisScan.mockResolvedValue(['0', ['capacity:running:org-race']]);
    mockRedisGet.mockResolvedValue('3');
    await reconcileCapacityCounters(mockQueues, true);
    expect(mockRedisSet).not.toHaveBeenCalled();
    await reconcileCapacityCounters(mockQueues, true);
    expect(mockRedisSet).toHaveBeenCalledTimes(1);
  });

  it('pages large queues and deduplicates jobs that move across mutable pages', async () => {
    const page = Array.from({ length: 250 }, (_, id) => ({ id: String(id), data: { organizationId: 'org-1' } }));
    mockQueue.getJobs.mockResolvedValueOnce(page).mockResolvedValueOnce([page[0], { id: '250', data: { organizationId: 'org-1' } }]);
    await reconcileCapacityCounters({ ...mockQueues, k6Queues: {} }, true);
    mockQueue.getJobs.mockResolvedValueOnce(page).mockResolvedValueOnce([page[0], { id: '250', data: { organizationId: 'org-1' } }]);
    await reconcileCapacityCounters({ ...mockQueues, k6Queues: {} }, true);
    expect(mockQueue.getJobs).toHaveBeenNthCalledWith(2, expect.any(Array), 250, 499);
    expect(mockRedisSet).toHaveBeenCalledWith('capacity:running:org-1', '251', expect.any(String), expect.any(Number));
  });

  it('should gracefully handle empty queues', async () => {
    mockQueue.getJobs.mockResolvedValue([]);
    mockRedisScan.mockResolvedValue(['0', []]);
    
    await reconcileCapacityCounters(mockQueues, true);
    
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('retains capacity for admitted retries and paused or disabled waiting work', async () => {
    mockQueue.getJobs.mockImplementation((states: string[]) => Promise.resolve(
      states.includes('delayed') && states.includes('paused')
        ? [{ id: 'retry-1', data: { organizationId: 'org-1' } }]
        : [],
    ));
    mockRedisScan.mockResolvedValue(['0', ['capacity:running:org-1']]);
    mockRedisGet.mockResolvedValue('2');
    await reconcileCapacityCounters(mockQueues, true);
    expect(mockQueue.getJobs).toHaveBeenCalledWith([
      'active', 'waiting', 'delayed', 'paused', 'prioritized', 'waiting-children',
    ], 0, 249);
    expect(mockRedisDel).not.toHaveBeenCalledWith('capacity:running:org-1');
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});
