/**
 * Hand-off of recorded code from the recorder back to the Supercheck Playground.
 * Recorded scripts can contain typed credentials, so they are only delivered to
 * the Supercheck origin the recording was started from, and only reported as
 * saved once the page has acknowledged them.
 */

export const RECORDED_CODE = 'SUPERCHECK_RECORDED_CODE';
export const RECORDED_CODE_ACK = 'SUPERCHECK_RECORDED_CODE_ACK';

type HandOffResponse = { success?: boolean; error?: string } | undefined;

/** Send code to the background worker; throws unless it reports success. */
export async function sendRecordedCode(
  send: (message: unknown) => Promise<HandOffResponse>,
  sourceTabId: number | undefined,
  code: string,
): Promise<void> {
  if (!sourceTabId)
    throw new Error('No source tab found - recording was not started from Supercheck');
  const response = await send({ type: 'INTERNAL_SEND_CODE_TO_PLAYGROUND', payload: { code } });
  if (!response?.success)
    throw new Error(response?.error || 'Failed to send code to Supercheck');
}

/** Throws unless the source tab is still on the origin recorded at start. */
export function assertSourceTab(tab: { url?: string }, recordedOrigin: string | undefined): void {
  let current: string | undefined;
  try {
    current = tab.url ? new URL(tab.url).origin : undefined;
  } catch {
    // an unparsable URL is treated as untrusted
  }
  if (!recordedOrigin || current !== recordedOrigin)
    throw new Error('Source tab navigated away from Supercheck');
}

/**
 * Content-script side: post the code to the page with an explicit target origin
 * and answer `respond` once the page acks (or after `timeoutMs`).
 */
export function relayRecordedCode(
  win: Window,
  message: { payload?: unknown; targetOrigin?: string },
  respond: (response: { success: boolean; error?: string }) => void,
  timeoutMs = 3000,
): void {
  const { targetOrigin } = message;
  if (!targetOrigin || win.location.origin !== targetOrigin) {
    respond({ success: false, error: 'Page is not the Supercheck origin the recording started from' });
    return;
  }
  const finish = (response: { success: boolean; error?: string }) => {
    clearTimeout(timer);
    win.removeEventListener('message', onMessage);
    respond(response);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source === win && event.origin === targetOrigin && event.data?.type === RECORDED_CODE_ACK)
      finish({ success: true });
  };
  const timer = setTimeout(() => finish({ success: false, error: 'Supercheck did not accept the recorded code' }), timeoutMs);
  win.addEventListener('message', onMessage);
  win.postMessage({ type: RECORDED_CODE, payload: message.payload, source: 'supercheck-recorder' }, targetOrigin);
}
