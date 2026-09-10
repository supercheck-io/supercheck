/**
 * Supercheck Recorder - Message Bridge
 *
 * Handles communication between the Supercheck web app and the extension.
 * Enables SEAMLESS authentication - no manual setup required.
 *
 * Flow:
 * 1. User installs extension
 * 2. User visits Supercheck and logs in
 * 3. Supercheck app detects extension and auto-connects it
 * 4. User can start recording immediately
 */

import { getConfig, saveConfig } from './config';
import { apiClient } from './api-client';
import {
  isAllowedAppOrigin,
  isValidAutoConnectPayload,
  type AutoConnectPayload,
} from './message-security';

export { isAllowedAppOrigin, isValidAutoConnectPayload } from './message-security';

export const MESSAGE_TYPES = {
  // From Supercheck App → Extension
  CHECK_EXTENSION: 'SUPERCHECK_CHECK_EXTENSION',
  START_RECORDING: 'SUPERCHECK_START_RECORDING',
  AUTO_CONNECT: 'SUPERCHECK_AUTO_CONNECT', // Seamless auth - app sends credentials automatically
  DISCONNECT_EXTENSION: 'SUPERCHECK_DISCONNECT_EXTENSION',

  // From Extension → Supercheck App
  EXTENSION_READY: 'SUPERCHECK_RECORDER_READY',
  EXTENSION_CONNECTED: 'SUPERCHECK_EXTENSION_CONNECTED',
  EXTENSION_DISCONNECTED: 'SUPERCHECK_EXTENSION_DISCONNECTED',
  EXTENSION_NEEDS_AUTH: 'SUPERCHECK_EXTENSION_NEEDS_AUTH', // Extension requests credentials
  RECORDING_STARTED: 'SUPERCHECK_RECORDING_STARTED',
  RECORDING_COMPLETE: 'SUPERCHECK_RECORDING_COMPLETE',
  RECORDING_ERROR: 'SUPERCHECK_RECORDING_ERROR',
} as const;

export interface StartRecordingPayload {
  projectId?: string;
  testName?: string;
  targetUrl?: string;
}

export interface RecordingCompletePayload {
  script: string;
  metadata: {
    recordedAt: string;
    duration: number;
    stepsCount: number;
    baseUrl: string;
  };
  savedTestId?: string;
  redirectUrl?: string;
}

/**
 * Check if origin is allowed for communication
 */
async function isAllowedOrigin(origin: string): Promise<boolean> {
  const config = await getConfig();
  return isAllowedAppOrigin(origin, config?.instanceUrl);
}

/**
 * Send message to the Supercheck app
 */
export function sendMessageToApp(type: string, payload?: unknown): void {
  window.postMessage({ type, payload, source: 'supercheck-recorder' }, window.location.origin);
}

/**
 * Announce extension presence to the page
 */
export function announceExtension(): void {
  sendMessageToApp(MESSAGE_TYPES.EXTENSION_READY, {
    version: chrome.runtime.getManifest().version,
  });
}

/**
 * Handle incoming messages from the Supercheck app
 */
async function handleMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window)
    return;

  // Only handle messages from allowed origins
  if (!await isAllowedOrigin(event.origin))
    return;


  const message = event.data;
  if (!message?.type || message.source === 'supercheck-recorder')
    return;


  switch (message.type) {
    case MESSAGE_TYPES.CHECK_EXTENSION:
      announceExtension();
      break;

    case MESSAGE_TYPES.AUTO_CONNECT:
      if (isValidAutoConnectPayload(message.payload, event.origin))
        await handleAutoConnect(message.payload);
      break;

    case MESSAGE_TYPES.DISCONNECT_EXTENSION:
      await handleDisconnect();
      break;

    case MESSAGE_TYPES.START_RECORDING:
      await handleStartRecording(message.payload as StartRecordingPayload);
      break;
  }
}

/**
 * Handle seamless auto-connect from Supercheck app
 * This is called automatically when user visits Supercheck while logged in
 */
async function handleAutoConnect(payload: AutoConnectPayload): Promise<void> {
  try {
    // Save configuration with autoConnected flag
    await saveConfig({
      instanceUrl: payload.instanceUrl,
      apiKey: payload.apiKey,
      userId: payload.userId,
      userEmail: payload.userEmail,
      autoConnected: true,
    });

    // Clear API client cache to use new config
    apiClient.clearCache();

    // Verify the connection works
    const verification = await apiClient.verifyConnection();

    if (verification.valid) {
      sendMessageToApp(MESSAGE_TYPES.EXTENSION_CONNECTED, {
        success: true,
        userId: payload.userId,
        userEmail: payload.userEmail,
      });
    } else {
      throw new Error('Connection verification failed');
    }
  } catch (error) {
    console.error('[Supercheck] Connection failed:', error);
    sendMessageToApp(MESSAGE_TYPES.EXTENSION_CONNECTED, {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    });
  }
}

/**
 * Handle extension disconnection
 */
async function handleDisconnect(): Promise<void> {
  try {
    const { clearConfig } = await import('./config');
    await clearConfig();
    apiClient.clearCache();

    sendMessageToApp(MESSAGE_TYPES.EXTENSION_DISCONNECTED, { success: true });
  } catch (error) {
    console.error('[Supercheck] Disconnect failed:', error);
    sendMessageToApp(MESSAGE_TYPES.EXTENSION_DISCONNECTED, {
      success: false,
      error: error instanceof Error ? error.message : 'Disconnect failed',
    });
  }
}

/**
 * Handle start recording request from Supercheck app
 */
async function handleStartRecording(payload: StartRecordingPayload): Promise<void> {
  try {
    // Forward to service worker to open side panel and start recording
    await chrome.runtime.sendMessage({
      type: 'INTERNAL_START_RECORDING',
      payload,
    });

    sendMessageToApp(MESSAGE_TYPES.RECORDING_STARTED, { success: true });
  } catch (error) {
    console.error('[Supercheck] Failed to start recording:', error);
    sendMessageToApp(MESSAGE_TYPES.RECORDING_ERROR, {
      error: error instanceof Error ? error.message : 'Failed to start recording',
    });
  }
}

/**
 * Initialize the message bridge (called from content script)
 */
export function initMessageBridge(): void {
  window.addEventListener('message', handleMessage);

  // Announce extension is ready
  announceExtension();

  // Re-announce on visibility change (user switches back to tab)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      announceExtension();

  });
}

/**
 * Cleanup the message bridge
 */
export function cleanupMessageBridge(): void {
  window.removeEventListener('message', handleMessage);
}
