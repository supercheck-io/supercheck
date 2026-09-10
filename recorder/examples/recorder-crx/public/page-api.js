/**
 * Supercheck Recorder - Page API
 *
 * This script runs in the PAGE context (not content script context)
 * and exposes window.__SUPERCHECK_RECORDER__ API for the app to use.
 *
 * Communication with content script happens via window.postMessage.
 */
(function() {
  'use strict';

  // Prevent double initialization
  if (window.__SUPERCHECK_RECORDER__) {
    console.log('[Supercheck Recorder] Page API already initialized');
    return;
  }

  var pendingCallbacks = new Map();
  var callId = 0;

  window.__SUPERCHECK_RECORDER__ = {
    version: '1.0.0',

    isConnected: function() {
      return new Promise(function(resolve) {
        var id = ++callId;
        pendingCallbacks.set(id, resolve);
        window.postMessage({
          type: 'SUPERCHECK_API_CALL',
          method: 'isConnected',
          callId: id
        }, window.location.origin);
        // Timeout after 3 seconds
        setTimeout(function() {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            resolve(false);
          }
        }, 3000);
      });
    },

    storeRecordingContext: function(payload) {
      return new Promise(function(resolve, reject) {
        var id = ++callId;
        pendingCallbacks.set(id, { resolve: resolve, reject: reject });
        window.postMessage({
          type: 'SUPERCHECK_API_CALL',
          method: 'storeRecordingContext',
          callId: id,
          payload: payload
        }, window.location.origin);
        // Timeout after 10 seconds
        setTimeout(function() {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            reject(new Error('Timeout waiting to store recording context'));
          }
        }, 10000);
      });
    }
  };

  // Listen for responses from content script
  window.addEventListener('message', function(event) {
    if (event.source === window && event.origin === window.location.origin && event.data && event.data.type === 'SUPERCHECK_API_RESPONSE') {
      var callback = pendingCallbacks.get(event.data.callId);
      if (callback) {
        pendingCallbacks.delete(event.data.callId);
        if (typeof callback === 'function') {
          callback(event.data.result);
        } else if (callback.resolve) {
          if (event.data.error) {
            callback.reject(new Error(event.data.error));
          } else {
            callback.resolve(event.data.result);
          }
        }
      }
    }
  });

// console.log('[Supercheck Recorder] Page API initialized');
})();
