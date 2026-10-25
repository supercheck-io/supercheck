'use client';

import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export function CopyEmail({ email }: { email: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(email);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 3000);
  }

  return (
    <p className="mt-4 text-center text-xs text-fd-muted-foreground">
      Buttons open your email app. No mail app? Email{' '}
      <span className="font-medium text-fd-foreground">{email}</span>{' '}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${email} to clipboard`}
        className="rounded border border-fd-border px-2 py-1 font-medium transition-colors hover:bg-fd-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
      >
        Copy
      </button>
      <span role="status" aria-live="polite" className={state === 'idle' ? '' : 'ml-2'}>
        {state === 'copied' && 'Copied'}
        {state === 'failed' && 'Copy failed. Select the address instead.'}
      </span>
    </p>
  );
}
