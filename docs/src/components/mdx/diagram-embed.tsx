'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

interface DiagramEmbedProps {
  /** Path to a self-contained diagram HTML file served from /public. */
  src: string;
  /** Accessible title for the embedded frame. */
  title: string;
  /** Initial frame height in pixels before the diagram reports its size. */
  height?: number;
}

const MIN_FRAME_HEIGHT = 320;
const MAX_FRAME_HEIGHT = 1600;
const HEIGHT_MESSAGE = 'supercheck-diagram-height';

/**
 * Embeds a self-contained diagram from /public in a lazy iframe with a link to
 * open it in a new tab. The diagram HTML includes its own styles, scripts,
 * light/dark theming, and reports its rendered height so the frame sizes to the
 * content exactly at any width — no letterboxing and no inner scrollbar.
 */
export function DiagramEmbed({ src, title, height = 820 }: DiagramEmbedProps): ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(height);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      const payload = event.data as { type?: unknown; height?: unknown } | null;
      if (!payload || payload.type !== HEIGHT_MESSAGE || typeof payload.height !== 'number') return;
      if (!Number.isFinite(payload.height)) return;
      setFrameHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.round(payload.height))));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="my-4 overflow-hidden rounded-lg border bg-card">
      <iframe
        ref={frameRef}
        src={src}
        title={title}
        loading="lazy"
        className="w-full"
        style={{ height: frameHeight, border: 0 }}
      />
      <div className="border-t px-3 py-2 text-right text-sm">
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`${title}: open diagram in a new tab`}
          className="font-medium underline underline-offset-4 hover:no-underline"
        >
          Open diagram in new tab
        </a>
      </div>
    </div>
  );
}
