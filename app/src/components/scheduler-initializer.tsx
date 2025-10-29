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

/**
 * Server component to initialize the job and monitor schedulers.
 *
 * Uses BullMQ's Job Schedulers feature (available in v5.16.0+) which is a more robust
 * replacement for repeatable jobs. Job Schedulers act as job factories, producing jobs
 * based on specified cron schedules. The scheduled jobs are persisted in Postgres db
 * to survive restarts.
 */
export async function SchedulerInitializer() {
  // Schedulers are always enabled - no option to disable
  try {
    // Initialize job scheduler synchronously to ensure it completes during startup
    const initializeAsync = async () => {
      try {
        await cleanupJobScheduler();
        const result = await initializeJobSchedulers();

        if (result.success) {
          if (result.failed && result.failed > 0) {
            console.warn(`⚠️ ${result.failed} job(s) failed to initialize`);
          }

          // Initialize unified data lifecycle service
          const lifecycleService = await initializeDataLifecycleService();
          if (lifecycleService) {
            const status = await lifecycleService.getStatus();
            if (status.enabledStrategies.length > 0) {
            } else {
            }
          } else {
            console.warn("⚠️ Data lifecycle service failed to initialize");
          }
        } else {
          console.error("❌ Job scheduler initialization failed", result.error);
        }
      } catch (error: unknown) {
        console.error("❌ Job scheduler error:", error);
        throw error;
      }
    };

    initializeAsync().catch((error) => {
      console.error("❌ Critical: Job scheduler failed during startup:", error);
    });
  } catch (error) {
    console.error("❌ Error starting job scheduler:", error);
  }

  try {
    // Initialize monitor scheduler synchronously to ensure it completes during startup
    const initializeAsync = async () => {
      try {
        await cleanupMonitorScheduler();
        const result = await initializeMonitorSchedulers();

        if (result.success) {
          console.log(
            `✅ Monitor scheduler initialized (${result.scheduled} monitors${
              result.failed ? `, ${result.failed} failed` : ""
            })`
          );

          if (result.failed > 0) {
            console.warn(`⚠️ ${result.failed} monitor(s) failed to initialize`);
          }
        } else {
          console.error("❌ Monitor scheduler initialization failed");
        }
      } catch (error: unknown) {
        console.error("❌ Monitor scheduler error:", error);
        throw error;
      }
    };

    initializeAsync().catch((error) => {
      console.error(
        "❌ Critical: Monitor scheduler failed during startup:",
        error
      );
    });
  } catch (error) {
    console.error("❌ Error starting monitor scheduler:", error);
  }

  // This is a server component, so it doesn't render anything
  return null;
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

  await Promise.allSettled([
    jobCleanupPromise,
    monitorSchedulerCleanupPromise,
    lifecycleCleanupPromise,
  ]);
  console.log("✅ Background tasks cleanup finished.");
}
