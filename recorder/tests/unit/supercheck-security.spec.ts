import { expect, test } from '@playwright/test';
import { isRetryableRequestMethod } from '../../examples/recorder-crx/src/supercheck/api-client';
import {
  isAllowedAppOrigin,
  isValidAutoConnectPayload,
  isValidRecordingContextPayload,
} from '../../examples/recorder-crx/src/supercheck/message-security';

test('accepts intended cloud, localhost, and configured origins', () => {
  expect(isAllowedAppOrigin('https://supercheck.io')).toBe(true);
  expect(isAllowedAppOrigin('https://app.supercheck.io')).toBe(true);
  expect(isAllowedAppOrigin('http://localhost:3000')).toBe(true);
  expect(isAllowedAppOrigin('https://self-hosted.example.com', 'https://self-hosted.example.com')).toBe(true);
});

test('rejects insecure and lookalike origins', () => {
  expect(isAllowedAppOrigin('http://app.supercheck.io')).toBe(false);
  expect(isAllowedAppOrigin('http://localhost.example.com')).toBe(false);
  expect(isAllowedAppOrigin('https://supercheck.io.example.com')).toBe(false);
  expect(isAllowedAppOrigin('not a URL')).toBe(false);
});

test('requires auto-connect credentials to target the sender origin', () => {
  const payload = {
    instanceUrl: 'https://supercheck.io',
    apiKey: 'ext_example',
    userId: 'user-1',
    userEmail: 'user@example.com',
  };

  expect(isValidAutoConnectPayload(payload, 'https://supercheck.io')).toBe(true);
  expect(isValidAutoConnectPayload(payload, 'https://app.supercheck.io')).toBe(false);
  expect(isValidAutoConnectPayload({ ...payload, apiKey: '' }, 'https://supercheck.io')).toBe(false);
});

test('accepts only bounded recording contexts from the sender origin', () => {
  const payload = {
    projectId: 'project-1',
    testName: 'Checkout',
    targetUrl: 'https://shop.example.com/checkout',
    returnUrl: 'https://supercheck.io/playground',
  };

  expect(isValidRecordingContextPayload(payload, 'https://supercheck.io')).toBe(true);
  expect(isValidRecordingContextPayload({ ...payload, projectId: '' }, 'https://supercheck.io')).toBe(false);
  expect(isValidRecordingContextPayload({ ...payload, targetUrl: 'javascript:alert(1)' }, 'https://supercheck.io')).toBe(false);
  expect(isValidRecordingContextPayload({ ...payload, returnUrl: 'https://evil.example' }, 'https://supercheck.io')).toBe(false);
});

test('retries only idempotent request methods', () => {
  expect(isRetryableRequestMethod()).toBe(true);
  expect(isRetryableRequestMethod('GET')).toBe(true);
  expect(isRetryableRequestMethod('PUT')).toBe(true);
  expect(isRetryableRequestMethod('DELETE')).toBe(true);
  expect(isRetryableRequestMethod('POST')).toBe(false);
  expect(isRetryableRequestMethod('PATCH')).toBe(false);
});
