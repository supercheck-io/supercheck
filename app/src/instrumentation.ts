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
    console.log('[Instrumentation] Starting - Loading email template processor...');
    // Import the email template processor to trigger auto-initialization
    await import('@/lib/processors/email-template-processor');
    console.log('[Instrumentation] ✅ Email template processor module loaded and initialized');
  }
}
