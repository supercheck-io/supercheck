/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * ALL background services should be initialized here, NOT in React components.
 *
 * CRITICAL: Initialization is NON-BLOCKING to ensure HTTP server starts immediately.
 * Background services initialize asynchronously - health checks will work even if
 * Redis/DB connections are slow or fail.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

/**
 * Initialize background services asynchronously (non-blocking)
 * This runs in the background after the HTTP server starts
 */
async function initializeBackgroundServices(): Promise<void> {
  // Small delay to ensure HTTP server is fully ready first
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Validate Polar configuration early in cloud mode
  try {
    console.log('[Instrumentation] Validating Polar configuration...');
    const { validatePolarConfig } = await import('@/lib/feature-flags');
    validatePolarConfig();
    console.log('[Instrumentation] ✅ Polar configuration validated');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing required Polar environment variables')) {
      console.error('[Instrumentation] ❌ CRITICAL: Polar configuration error:', error.message);
    } else {
      console.error('[Instrumentation] ❌ Polar configuration validation error:', error);
    }
  }

  // Initialize job schedulers with timeout to prevent blocking
  try {
    console.log('[Instrumentation] Initializing job schedulers...');
    const { initializeJobSchedulers, cleanupJobScheduler } = await import('@/lib/job-scheduler');
    
    // Use Promise.race with timeout to prevent indefinite blocking
    const timeout = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Job scheduler init timeout (30s)')), 30000)
    );
    
    await Promise.race([cleanupJobScheduler(), timeout]).catch(() => {});
    const jobResult = await Promise.race([initializeJobSchedulers(), timeout]);
    
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

  // Initialize data lifecycle service with timeout
  try {
    console.log('[Instrumentation] Loading data lifecycle service...');
    const { initializeDataLifecycleService } = await import('@/lib/job-scheduler');
    
    const timeout = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Data lifecycle init timeout (30s)')), 30000)
    );
    
    const lifecycleService = await Promise.race([initializeDataLifecycleService(), timeout]);
    if (lifecycleService) {
      const status = await lifecycleService.getStatus();
      console.log(`[Instrumentation] ✅ Data lifecycle service initialized (${status.enabledStrategies.length} strategies enabled)`);
    } else {
      console.warn('[Instrumentation] ⚠️ Data lifecycle service failed to initialize');
    }
  } catch (error) {
    console.error('[Instrumentation] ❌ Failed to initialize data lifecycle service:', error);
  }

  // Initialize monitor schedulers with timeout
  try {
    console.log('[Instrumentation] Initializing monitor schedulers...');
    const { initializeMonitorSchedulers, cleanupMonitorScheduler } = await import('@/lib/monitor-scheduler');
    
    const timeout = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Monitor scheduler init timeout (30s)')), 30000)
    );
    
    await Promise.race([cleanupMonitorScheduler(), timeout]).catch(() => {});
    const monitorResult = await Promise.race([initializeMonitorSchedulers(), timeout]);
    
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

  console.log('[Instrumentation] ✨ Background services startup complete');
}

export async function register() {
  // Only run on server-side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Starting - Background services will initialize asynchronously...');

    // CRITICAL: Don't await - let HTTP server start immediately
    // Background services initialize in parallel, health checks work immediately
    initializeBackgroundServices().catch((error) => {
      console.error('[Instrumentation] ❌ Background services initialization failed:', error);
    });

    console.log('[Instrumentation] HTTP server starting (background services initializing...)');
  }
}
