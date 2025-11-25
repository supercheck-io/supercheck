/**
 * Next.js Instrumentation
 *
 * This file runs once when the Next.js server starts.
 * Used to initialize background services like the email template processor.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server-side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Starting - Loading background services...');

    try {
      // Initialize data lifecycle service (cleanup/retention management)
      console.log('[Instrumentation] Loading data lifecycle service...');
      const { initializeDataLifecycleService } = await import('@/lib/job-scheduler');
      const lifecycleService = await initializeDataLifecycleService();
      if (lifecycleService) {
        const status = await lifecycleService.getStatus();
        console.log(`[Instrumentation] ✅ Data lifecycle service initialized (${status.enabledStrategies.length} strategies enabled)`);
        if (status.enabledStrategies.length > 0) {
          console.log(`    Enabled: ${status.enabledStrategies.join(', ')}`);
        }
      } else {
        console.warn('[Instrumentation] ⚠️ Data lifecycle service failed to initialize');
      }
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize data lifecycle service:', error);
    }

    try {
      // Initialize email template processor
      console.log('[Instrumentation] Loading email template processor...');
      await import('@/lib/processors/email-template-processor');
      console.log('[Instrumentation] ✅ Email template processor module loaded and initialized');
    } catch (error) {
      console.error('[Instrumentation] ❌ Failed to initialize email template processor:', error);
    }

    console.log('[Instrumentation] ✨ Background services startup complete');
  }
}
