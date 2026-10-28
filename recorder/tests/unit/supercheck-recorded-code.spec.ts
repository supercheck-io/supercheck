import { expect, test } from '@playwright/test';
import {
  assertSourceTab,
  relayRecordedCode,
  sendRecordedCode,
} from '../../examples/recorder-crx/src/supercheck/recorded-code';

test('keeps the recording when the hand-off is refused', async () => {
  await expect(sendRecordedCode(async () => ({ success: false, error: 'Source tab was closed' }), 7, 'code'))
    .rejects.toThrow('Source tab was closed');
  await expect(sendRecordedCode(async () => undefined, 7, 'code')).rejects.toThrow();
  await expect(sendRecordedCode(async () => ({ success: true }), undefined, 'code')).rejects.toThrow(/source tab/i);
  await expect(sendRecordedCode(async () => ({ success: true }), 7, 'code')).resolves.toBeUndefined();
});

test('only trusts a source tab that is still on the recorded Supercheck origin', () => {
  const origin = 'https://app.supercheck.io';
  expect(() => assertSourceTab({ url: 'https://app.supercheck.io/playground' }, origin)).not.toThrow();
  expect(() => assertSourceTab({ url: 'https://evil.example/' }, origin)).toThrow(/navigated/);
  expect(() => assertSourceTab({ url: undefined }, origin)).toThrow(/navigated/);
  expect(() => assertSourceTab({ url: 'https://app.supercheck.io/' }, undefined)).toThrow(/navigated/);
});

function fakeWindow(origin: string) {
  const listeners: ((event: unknown) => void)[] = [];
  const posted: { message: unknown; target: string }[] = [];
  const win = {
    location: { origin },
    postMessage: (message: unknown, target: string) => { posted.push({ message, target }); },
    addEventListener: (_: string, listener: (event: unknown) => void) => { listeners.push(listener); },
    removeEventListener: () => {},
  };
  return { win: win as unknown as Window, posted, ack: (event: unknown) => listeners.forEach(l => l(event)) };
}

const message = { payload: { code: 'await page.fill("#pw", "secret")' }, targetOrigin: 'https://app.supercheck.io' };

test('does not post recorded code to a page that is not the recorded origin', () => {
  const { win, posted } = fakeWindow('https://evil.example');
  let response: unknown;
  relayRecordedCode(win, message, r => { response = r; }, 50);
  expect(posted).toEqual([]);
  expect(response).toMatchObject({ success: false });
});

test('posts to the explicit origin and reports success only after the page acknowledges', async () => {
  const { win, posted, ack } = fakeWindow('https://app.supercheck.io');
  const responses: unknown[] = [];
  relayRecordedCode(win, message, r => responses.push(r), 200);
  expect(posted).toHaveLength(1);
  expect(posted[0].target).toBe('https://app.supercheck.io');
  expect(responses).toEqual([]);
  ack({ source: win, origin: 'https://app.supercheck.io', data: { type: 'SUPERCHECK_RECORDED_CODE_ACK' } });
  expect(responses).toEqual([{ success: true }]);
});

test('reports failure when no page listener acknowledges the code', async () => {
  const { win } = fakeWindow('https://app.supercheck.io');
  const response = await new Promise(resolve => relayRecordedCode(win, message, resolve, 20));
  expect(response).toMatchObject({ success: false });
});
