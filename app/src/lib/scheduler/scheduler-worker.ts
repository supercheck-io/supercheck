/**
 * Scheduler Worker Initialization
 *
 * Initializes BullMQ Workers to process scheduled job and monitor triggers.
 * This runs in the Next.js app context, giving direct access to the
 * capacity manager for job queueing.
 *
 * Uses singleton pattern to handle Next.js hot-reload safely.
 */

import { Worker } from 'bullmq';
import { getWorkerConnection, queueLogger } from '@/lib/queue';
import { processScheduledJob, type ScheduledJobData } from './job-scheduler';
import { processScheduledMonitor, type MonitorJobData } from './monitor-scheduler';
import {
  JOB_SCHEDULER_QUEUE,
  K6_JOB_SCHEDULER_QUEUE,
  MONITOR_SCHEDULER_QUEUE,
} from './constants';

const logger = queueLogger;

// Singleton workers (handles Next.js hot-reload)
let playwrightSchedulerWorker: Worker | null = null;
let k6SchedulerWorker: Worker | null = null;
let monitorSchedulerWorker: Worker | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Use globalThis to persist flag across hot-reloads in development
declare global {
  var processListenersAttached: boolean | undefined;
}

// Worker settings optimized for schedulers (fast processing)
const workerSettings = {
  concurrency: 5, // Process up to 5 scheduler jobs concurrently
  lockDuration: 2 * 60 * 1000, // 2 minutes - schedulers are fast
  stalledInterval: 30000,
  maxStalledCount: 2,
};

/**
 * Initialize all scheduler workers
 *
 * This function should be called once when the app starts.
 * It's safe to call multiple times - subsequent calls are no-ops.
 */
export async function initializeSchedulerWorkers(): Promise<void> {
  // Return existing promise if initialization is in progress
  if (initPromise) {
    return initPromise;
  }

  // Skip if already initialized
  if (isInitialized) {
    return;
  }

  initPromise = (async () => {
    try {
      logger.info({}, 'Initializing scheduler workers');

      // Get shared base connection for Workers
      // Per BullMQ docs: Workers CAN share a base connection. BullMQ internally
      // creates separate blocking connections (via duplicate()) for BRPOPLPUSH/BLMOVE.
      // Benefits:
      // - Simplifies connection management (single getWorkerConnection() call)
      // - Reduces initial connection overhead (one base vs three)
      // - BullMQ handles internal blocking connections automatically
      // https://docs.bullmq.io/guide/connections
      const sharedWorkerConn = await getWorkerConnection();

      // Playwright Job Scheduler Worker
      playwrightSchedulerWorker = new Worker<ScheduledJobData>(
        JOB_SCHEDULER_QUEUE,
        async (job) => {
          logger.debug({ jobId: job.id, name: job.name }, 'Processing Playwright scheduler job');
          return processScheduledJob(job);
        },
        {
          connection: sharedWorkerConn,
          autorun: false, // Don't start until we're ready
          ...workerSettings,
        }
      );

      playwrightSchedulerWorker.on('completed', (job) => {
        logger.debug({ jobId: job?.id }, 'Playwright scheduler job completed');
      });

      playwrightSchedulerWorker.on('failed', (job, error) => {
        logger.error({ jobId: job?.id, error }, 'Playwright scheduler job failed');
      });

      playwrightSchedulerWorker.on('error', (error) => {
        logger.error({ error }, 'Playwright scheduler worker error');
      });

      // K6 Job Scheduler Worker
      k6SchedulerWorker = new Worker<ScheduledJobData>(
        K6_JOB_SCHEDULER_QUEUE,
        async (job) => {
          logger.debug({ jobId: job.id, name: job.name }, 'Processing K6 scheduler job');
          return processScheduledJob(job);
        },
        {
          connection: sharedWorkerConn,
          autorun: false,
          ...workerSettings,
        }
      );

      k6SchedulerWorker.on('completed', (job) => {
        logger.debug({ jobId: job?.id }, 'K6 scheduler job completed');
      });

      k6SchedulerWorker.on('failed', (job, error) => {
        logger.error({ jobId: job?.id, error }, 'K6 scheduler job failed');
      });

      k6SchedulerWorker.on('error', (error) => {
        logger.error({ error }, 'K6 scheduler worker error');
      });

      // Monitor Scheduler Worker
      monitorSchedulerWorker = new Worker<MonitorJobData>(
        MONITOR_SCHEDULER_QUEUE,
        async (job) => {
          // DEBUG logging removed to reduce log pollution
          return processScheduledMonitor(job);
        },
        {
          connection: sharedWorkerConn,
          autorun: false,
          ...workerSettings,
        }
      );

      monitorSchedulerWorker.on('completed', () => {
        // DEBUG logging removed to reduce log pollution
      });

      monitorSchedulerWorker.on('failed', (job, error) => {
        logger.error({ jobId: job?.id, error }, 'Monitor scheduler job failed');
      });

      monitorSchedulerWorker.on('error', (error) => {
        logger.error({ error }, 'Monitor scheduler worker error');
      });

      // Start all workers after setup is complete
      await Promise.all([
        playwrightSchedulerWorker.run(),
        k6SchedulerWorker.run(),
        monitorSchedulerWorker.run(),
      ]);

      isInitialized = true;
      logger.info(
        {
          queues: [JOB_SCHEDULER_QUEUE, K6_JOB_SCHEDULER_QUEUE, MONITOR_SCHEDULER_QUEUE],
        },
        'Scheduler workers initialized successfully'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to initialize scheduler workers');
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Gracefully shutdown all scheduler workers
 */
export async function shutdownSchedulerWorkers(): Promise<void> {
  logger.info({}, 'Shutting down scheduler workers');

  const workers = [playwrightSchedulerWorker, k6SchedulerWorker, monitorSchedulerWorker];

  await Promise.all(
    workers.map(async (worker) => {
      if (worker) {
        await worker.close();
      }
    })
  );

  playwrightSchedulerWorker = null;
  k6SchedulerWorker = null;
  monitorSchedulerWorker = null;
  isInitialized = false;
  initPromise = null;

  logger.info({}, 'Scheduler workers shut down');
}

/**
 * Check if scheduler workers are running
 */
export function isSchedulerWorkersRunning(): boolean {
  return isInitialized;
}

// Handle process termination gracefully
// Only attach process listeners once per application lifecycle
// This prevents MaxListenersExceededWarning in development with hot reloading
if (typeof process !== 'undefined' && !globalThis.processListenersAttached) {
  globalThis.processListenersAttached = true;

  process.once('SIGTERM', () => {
    shutdownSchedulerWorkers().catch((err) => {
      logger.error({ err }, 'Error during SIGTERM shutdown');
    });
  });

  process.once('SIGINT', () => {
    shutdownSchedulerWorkers().catch((err) => {
      logger.error({ err }, 'Error during SIGINT shutdown');
    });
  });
}
