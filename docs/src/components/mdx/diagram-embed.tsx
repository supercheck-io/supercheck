import type { ReactElement } from 'react';

interface DiagramEmbedProps {
  /** Path to a self-contained diagram HTML file served from /public. */
  src: string;
  /** Accessible title for the embedded frame. */
  title: string;
  /** Rendered height of the diagram frame in pixels. */
  height?: number;
}

/**
 * Embeds a self-contained, interactive Archify diagram from /public in a lazy
 * iframe with a full-screen escape hatch. The diagram HTML includes its own
 * styles, scripts, and exports, so no external assets are required.
 */
export function DiagramEmbed({ src, title, height = 820 }: DiagramEmbedProps): ReactElement {
  return (
    <div className="my-4 overflow-hidden rounded-lg border bg-card">
      <iframe
        src={src}
        title={title}
        loading="lazy"
        className="w-full"
        style={{ height, border: 0 }}
      />
      <div className="border-t px-3 py-2 text-right text-sm">
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-4 hover:no-underline"
        >
          Open full screen
        </a>
      </div>
    </div>
  );
}
