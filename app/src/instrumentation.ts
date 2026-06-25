/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * ALL background services should be initialized here, NOT in React components.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server-side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Starting - Loading background services...');

    // Validate Polar configuration early in cloud mode
    try {
      console.log('[Instrumentation] Validating Polar configuration...');
      const { validatePolarConfig } = await import('@/lib/feature-flags');
      validatePolarConfig();
      console.log('[Instrumentation] ✅ Polar configuration validated');
    } catch (error) {
      // In cloud mode, Polar config is critical - fail fast
      if (error instanceof Error && error.message.includes('Missing required Polar environment variables')) {
        console.error('[Instrumentation] ❌ CRITICAL: Polar configuration error:', error.message);
        console.error('[Instrumentation] 💡 Please set the required environment variables and restart the server');
        // Don't throw here to allow the app to start in self-hosted mode, but log clearly
      } else {
        console.error('[Instrumentation] ❌ Polar configuration validation error:', error);
      }
    }

    // Initialize job schedulers (MOVED from SchedulerInitializer component)
    try {
      console.log('[Instrumentation] Initializing job schedulers...');
      const { initializeJobSchedulers, cleanupJobScheduler } = await import('@/lib/job-scheduler');
      await cleanupJobScheduler();
      const jobResult = await initializeJobSchedulers();
      if (jobResult.success) {
        console.log(`[Instrumentation] ✅ Job scheduler initialized (${jobResult.initialized} scheduled)`);
        if (jobResult.failed && jobResult.failed > 0) {
          console.warn(`[Instrumentation] ⚠️ ${jobResult.failed} job(s) failed to initialize`);
        }
      } else {
        console.error('[Instrumentation] ❌ Job scheduler initialization failed', jobResult.error);
      }
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize job schedulers:', error);
    }

    // Initialize data lifecycle service
    try {
      console.log('[Instrumentation] Loading data lifecycle service...');
      const { initializeDataLifecycleService } = await import('@/lib/job-scheduler');
      const lifecycleService = await initializeDataLifecycleService();
      if (lifecycleService) {
        // Use lightweight method that doesn't query database to avoid ECONNRESET during startup
        const strategiesCount = lifecycleService.getEnabledStrategiesCount();
        console.log(`[Instrumentation] ✅ Data lifecycle service initialized (${strategiesCount} strategies enabled)`);
      } else {
        console.warn('[Instrumentation] ⚠️ Data lifecycle service failed to initialize');
      }
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize data lifecycle service:', error);
    }

    // Initialize Polar usage retry sync. This is runtime-portable; database
    // advisory locking keeps it safe with multiple app instances.
    try {
      console.log('[Instrumentation] Initializing usage sync scheduler...');
      const { initializeUsageSyncScheduler } = await import('@/lib/services/usage-sync-scheduler');
      initializeUsageSyncScheduler();
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize usage sync scheduler:', error);
    }

    // Initialize monitor schedulers (MOVED from SchedulerInitializer component)
    try {
      console.log('[Instrumentation] Initializing monitor schedulers...');
      const { initializeMonitorSchedulers, cleanupMonitorScheduler } = await import('@/lib/monitor-scheduler');
      await cleanupMonitorScheduler();
      const monitorResult = await initializeMonitorSchedulers();
      if (monitorResult.success) {
        console.log(`[Instrumentation] ✅ Monitor scheduler initialized (${monitorResult.scheduled} monitors)`);
        if (monitorResult.failed && monitorResult.failed > 0) {
          console.warn(`[Instrumentation] ⚠️ ${monitorResult.failed} monitor(s) failed to initialize`);
        }
      } else {
        console.error('[Instrumentation] ❌ Monitor scheduler initialization failed');
      }
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize monitor schedulers:', error);
    }

    // Initialize email template processor
    try {
      console.log('[Instrumentation] Loading email template processor...');
      const { initializeEmailTemplateProcessor } = await import('@/lib/processors/email-template-processor');
      await initializeEmailTemplateProcessor();
      console.log('[Instrumentation] ✅ Email template processor initialized');
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize email template processor:', error);
    }

    // Initialize SRE alert triage processor only when explicitly enabled.
    try {
      const { initializeSreAlertTriageProcessor } = await import('@/sre/lib/background-alert-triage-processor');
      const initialized = await initializeSreAlertTriageProcessor();
      if (initialized) {
        console.log('[Instrumentation] ✅ SRE alert triage processor initialized');
      }
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize SRE alert triage processor:', error);
    }

    console.log('[Instrumentation] ✨ Background services startup complete');
  }
}
