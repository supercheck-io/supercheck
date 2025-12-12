"use server";

import {
  initializeJobSchedulers,
  cleanupJobScheduler,
  initializeDataLifecycleService,
  cleanupDataLifecycleService,
} from "@/lib/job-scheduler";
import {
  initializeMonitorSchedulers,
  cleanupMonitorScheduler,
} from "@/lib/monitor-scheduler";
import {
  initializeEmailTemplateProcessor,
  shutdownEmailTemplateProcessor,
} from "@/lib/processors/email-template-processor";

/**
 * Singleton guard to ensure initialization only happens once per server process.
 * This prevents repeated initialization on every page render in development mode.
 */
let initializationPromise: Promise<void> | null = null;
let isInitialized = false;

/**
 * Server component to initialize the job and monitor schedulers.
 *
 * Uses BullMQ's Job Schedulers feature (available in v5.16.0+) which is a more robust
 * replacement for repeatable jobs. Job Schedulers act as job factories, producing jobs
 * based on specified cron schedules. The scheduled jobs are persisted in Postgres db
 * to survive restarts.
 */
export async function SchedulerInitializer() {
  // Skip if already initialized
  if (isInitialized) {
    return null;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    await initializationPromise;
    return null;
  }

  // Start initialization
  initializationPromise = doInitialize();
  await initializationPromise;
  isInitialized = true;

  return null;
}

/**
 * Actual initialization logic, separated for singleton pattern
 */
async function doInitialize(): Promise<void> {
  console.log("🚀 SchedulerInitializer starting...");

  try {
    // Initialize job scheduler
    console.log("📋 Initializing job scheduler...");
    await cleanupJobScheduler();
    const jobResult = await initializeJobSchedulers();

    if (jobResult.success) {
      console.log(
        `✅ Job scheduler initialized (${jobResult.initialized} scheduled${jobResult.failed ? `, ${jobResult.failed} failed` : ""
        })`
      );
      if (jobResult.failed && jobResult.failed > 0) {
        console.warn(`⚠️ ${jobResult.failed} job(s) failed to initialize`);
      }
    } else {
      console.error("❌ Job scheduler initialization failed", jobResult.error);
    }

    // Initialize unified data lifecycle service
    console.log("ℹ️ Initializing data lifecycle service...");
    const lifecycleService = await initializeDataLifecycleService();
    if (lifecycleService) {
      const status = await lifecycleService.getStatus();
      console.log(
        `✅ Data lifecycle service initialized (${status.enabledStrategies.length} strategies enabled)`
      );
      if (status.enabledStrategies.length > 0) {
        console.log(`   Enabled strategies: ${status.enabledStrategies.join(", ")}`);
      }
    } else {
      console.warn("⚠️ Data lifecycle service failed to initialize");
    }
  } catch (error) {
    console.error("❌ Job scheduler error:", error);
  }

  try {
    // Initialize monitor scheduler
    console.log("🔔 Initializing monitor scheduler...");
    await cleanupMonitorScheduler();
    const monitorResult = await initializeMonitorSchedulers();

    if (monitorResult.success) {
      console.log(
        `✅ Monitor scheduler initialized (${monitorResult.scheduled} monitors${monitorResult.failed ? `, ${monitorResult.failed} failed` : ""
        })`
      );

      if (monitorResult.failed > 0) {
        console.warn(`⚠️ ${monitorResult.failed} monitor(s) failed to initialize`);
      }
    } else {
      console.error("❌ Monitor scheduler initialization failed");
    }
  } catch (error) {
    console.error("❌ Monitor scheduler error:", error);
  }

  try {
    // Initialize email template processor for worker template rendering requests
    console.log("📧 Initializing email template processor...");
    await initializeEmailTemplateProcessor();
    console.log("✅ Email template processor initialized");
  } catch (error) {
    console.error("❌ Email template processor error:", error);
  }

  console.log("✨ SchedulerInitializer completed");
}

// Optional: Add a cleanup function for graceful shutdown if the app supports it
// This might be called from a global server shutdown hook
export async function cleanupBackgroundTasks() {
  console.log("🧹 Cleaning up background tasks...");
  const jobCleanupPromise = cleanupJobScheduler().catch((e) =>
    console.error("Error cleaning job scheduler:", e)
  );
  const monitorSchedulerCleanupPromise = cleanupMonitorScheduler().catch((e) =>
    console.error("Error cleaning monitor scheduler:", e)
  );
  const lifecycleCleanupPromise = cleanupDataLifecycleService().catch((e) =>
    console.error("Error cleaning data lifecycle service:", e)
  );
  const emailProcessorCleanupPromise = shutdownEmailTemplateProcessor().catch(
    (e) => console.error("Error cleaning email template processor:", e)
  );

  await Promise.allSettled([
    jobCleanupPromise,
    monitorSchedulerCleanupPromise,
    lifecycleCleanupPromise,
    emailProcessorCleanupPromise,
  ]);
  console.log("✅ Background tasks cleanup finished.");
}
