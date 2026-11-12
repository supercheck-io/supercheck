/**
 * Preloaded with `node --require ./dist/src/instrument.js` so Sentry patches
 * http, pg and ioredis before the app imports them. Loads no @sentry/* code
 * unless the gate passes (Supercheck Cloud with SENTRY_DSN, not a private agent).
 */
import { getSentryDsn } from './common/sentry-gate';

if (getSentryDsn()) {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const sentry =
      require('./common/sentry') as typeof import('./common/sentry');
    /* eslint-enable @typescript-eslint/no-require-imports */
    sentry.initSentry();
  } catch (error) {
    console.error('[sentry] preload init failed:', (error as Error)?.message);
  }
}
