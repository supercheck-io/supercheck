/**
 * Playwright Global Setup for Network Events API Instrumentation
 *
 * This setup file ensures the network events file is initialized
 * before tests run. The actual instrumentation happens via fixtures
 * that are automatically applied to all tests through test setup.
 */

const fs = require('fs');
const path = require('path');

/**
 * Global setup - runs once before all tests
 */
async function globalSetup(config) {
  if (!process.env.PLAYWRIGHT_NETWORK_EVENTS_FILE) {
    console.log('[Network Events] PLAYWRIGHT_NETWORK_EVENTS_FILE not set, skipping network capture');
    return;
  }

  const networkEventsFile = process.env.PLAYWRIGHT_NETWORK_EVENTS_FILE;

  console.log('[Network Events] Initializing Network Events API capture');
  console.log(`[Network Events] Output file: ${networkEventsFile}`);

  // Ensure directory exists
  const dir = path.dirname(networkEventsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Clear previous file
  if (fs.existsSync(networkEventsFile)) {
    fs.unlinkSync(networkEventsFile);
  }

  // Create empty file
  fs.writeFileSync(networkEventsFile, '', 'utf8');

  console.log('[Network Events] Network Events API instrumentation ready');
}

/**
 * Global teardown - runs once after all tests
 */
async function globalTeardown(config) {
  console.log('[Network Events] Global teardown complete');
}

module.exports = globalSetup;
module.exports.globalTeardown = globalTeardown;
