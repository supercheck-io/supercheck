/**
 * Supercheck Recorder - Content Script
 *
 * Injected into Supercheck pages to enable seamless communication
 * between the web app and the extension.
 *
 * When extensions are reloaded, old content scripts become "orphaned" and cannot
 * communicate with the new background. This script detects that and tells the
 * page to refresh.
 */

import { getConfig } from './supercheck/config';
import {
  isAllowedAppOrigin,
  isValidAutoConnectPayload,
  isValidRecordingContextPayload,
} from './supercheck/message-security';

const MESSAGE_TYPES = {
  CHECK_EXTENSION: 'SUPERCHECK_CHECK_EXTENSION',
  STORE_RECORDING_CONTEXT: 'SUPERCHECK_STORE_RECORDING_CONTEXT',
  AUTO_CONNECT: 'SUPERCHECK_AUTO_CONNECT',
  DISCONNECT_EXTENSION: 'SUPERCHECK_DISCONNECT_EXTENSION',
  EXTENSION_READY: 'SUPERCHECK_RECORDER_READY',
  EXTENSION_CONNECTED: 'SUPERCHECK_EXTENSION_CONNECTED',
  EXTENSION_DISCONNECTED: 'SUPERCHECK_EXTENSION_DISCONNECTED',
  RECORDING_CONTEXT_STORED: 'SUPERCHECK_RECORDING_CONTEXT_STORED',
  RECORDING_CONTEXT_ERROR: 'SUPERCHECK_RECORDING_CONTEXT_ERROR',
  REFRESH_REQUIRED: 'SUPERCHECK_REFRESH_REQUIRED',
} as const;

/**
 * Check if the origin is allowed to communicate with the extension.
 */
async function isAllowedOrigin(origin: string): Promise<boolean> {
  const config = await getConfig();
  return isAllowedAppOrigin(origin, config.instanceUrl);
}

function sendMessageToApp(type: string, payload?: unknown): void {
  try {
    window.postMessage({ type, payload, source: 'supercheck-recorder' }, window.location.origin);
  } catch {
    // Ignore errors
  }
}

/**
 * Ping the background script to verify we can communicate.
 */
function pingBackground(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, response => {
        if (chrome.runtime.lastError)
          resolve(false);
        else
          resolve(true);

      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Send message to background script.
 */
async function sendToBackground(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          sendMessageToApp(MESSAGE_TYPES.REFRESH_REQUIRED, {
            reason: 'Extension was updated. Please refresh the page.'
          });
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      sendMessageToApp(MESSAGE_TYPES.REFRESH_REQUIRED, {
        reason: 'Extension was updated. Please refresh the page.'
      });
      reject(error);
    }
  });
}

/**
 * Announce extension presence ONLY if we can actually communicate with background.
 */
async function announceExtension(): Promise<void> {
  const canReachBackground = await pingBackground();

  if (canReachBackground) {
    sendMessageToApp(MESSAGE_TYPES.EXTENSION_READY, { version: '1.0.0' });
  } else {
    sendMessageToApp(MESSAGE_TYPES.REFRESH_REQUIRED, {
      reason: 'Extension was updated. Please refresh the page.'
    });
  }
}

async function handleMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window || !await isAllowedOrigin(event.origin))
    return;


  const message = event.data;
  if (!message?.type || message.source === 'supercheck-recorder')
    return;

  switch (message.type) {
    case MESSAGE_TYPES.CHECK_EXTENSION:
      await announceExtension();
      break;

    case MESSAGE_TYPES.AUTO_CONNECT:
      if (!isValidAutoConnectPayload(message.payload, event.origin))
        return;
      try {
        await sendToBackground({
          type: 'INTERNAL_AUTO_CONNECT',
          payload: message.payload,
        });
        sendMessageToApp(MESSAGE_TYPES.EXTENSION_CONNECTED, { success: true });
      } catch (error) {
        sendMessageToApp(MESSAGE_TYPES.EXTENSION_CONNECTED, {
          success: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        });
      }
      break;

    case MESSAGE_TYPES.DISCONNECT_EXTENSION:
      try {
        await sendToBackground({ type: 'INTERNAL_DISCONNECT' });
        sendMessageToApp(MESSAGE_TYPES.EXTENSION_DISCONNECTED, { success: true });
      } catch (error) {
        sendMessageToApp(MESSAGE_TYPES.EXTENSION_DISCONNECTED, {
          success: false,
          error: error instanceof Error ? error.message : 'Disconnect failed'
        });
      }
      break;

    case MESSAGE_TYPES.STORE_RECORDING_CONTEXT:
      if (!isValidRecordingContextPayload(message.payload, event.origin))
        return;
      try {
        await sendToBackground({
          type: 'INTERNAL_STORE_RECORDING_CONTEXT',
          payload: message.payload,
        });
        sendMessageToApp(MESSAGE_TYPES.RECORDING_CONTEXT_STORED, { success: true });
      } catch (error) {
        sendMessageToApp(MESSAGE_TYPES.RECORDING_CONTEXT_ERROR, {
          error: error instanceof Error ? error.message : 'Failed to store recording context',
        });
      }
      break;
  }
}

// Initialize
window.addEventListener('message', handleMessage);

// Listen for messages from background script (e.g., recorded code)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SUPERCHECK_RECORDED_CODE') {
    sendMessageToApp('SUPERCHECK_RECORDED_CODE', message.payload);
    sendResponse({ success: true });
  }
  return true;
});

// Announce after a short delay (with background verification)
setTimeout(() => {
  void isAllowedOrigin(window.location.origin).then(allowed => {
    if (allowed)
      return announceExtension();
  });
}, 100);

// Re-announce on visibility change
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void isAllowedOrigin(window.location.origin).then(allowed => {
      if (allowed)
        return announceExtension();
    });
  }

});

// Inject external script into page context to expose API on page's window
function injectPageScript(): void {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-api.js');
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Listen for API calls from the injected page script
window.addEventListener('message', async event => {
  if (
    event.source !== window ||
    !await isAllowedOrigin(event.origin) ||
    event.data?.type !== 'SUPERCHECK_API_CALL'
  )
    return;

  const { method, callId, payload } = event.data;
  if (!Number.isSafeInteger(callId) || callId <= 0)
    return;

  try {
    let result;
    if (method === 'isConnected') {
      result = await pingBackground();
    } else if (method === 'storeRecordingContext') {
      if (!isValidRecordingContextPayload(payload, event.origin))
        throw new Error('Invalid recording context');
      await sendToBackground({
        type: 'INTERNAL_STORE_RECORDING_CONTEXT',
        payload,
      });
      result = true;
    }

    window.postMessage({
      type: 'SUPERCHECK_API_RESPONSE',
      callId,
      result
    }, window.location.origin);
  } catch (error) {
    window.postMessage({
      type: 'SUPERCHECK_API_RESPONSE',
      callId,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, window.location.origin);
  }
});

// Expose the page API only on a trusted Supercheck origin.
void isAllowedOrigin(window.location.origin).then(allowed => {
  if (allowed)
    injectPageScript();
});
