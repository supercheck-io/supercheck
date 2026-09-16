'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useId, useState, type ReactElement } from 'react';

export function Mermaid({ chart }: { chart: string }): ReactElement {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    // Dynamically import mermaid only on client-side
    import('mermaid').then((mermaidModule) => {
      const mermaid = mermaidModule.default;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
        // Keep diagrams at their natural size so labels stay readable. Wide
        // diagrams scroll horizontally instead of being scaled down.
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
      });

      mermaid
        .render(id, chart)
        .then((result) => {
          if (!cancelled) setSvg(result.svg);
        })
        .catch((e) => {
          console.error('Mermaid rendering error:', e);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [id, chart, resolvedTheme]);

  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  return (
    <div
      className={[
        'rounded-lg border bg-card',
        expanded ? 'fixed inset-0 z-[100] m-0 flex flex-col rounded-none' : 'group relative my-4',
      ].join(' ')}
    >
      {expanded ? (
        <div className="flex shrink-0 items-center justify-end border-b bg-card px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label="Collapse diagram"
          >
            <Minimize2 className="size-3.5" />
            Collapse
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border bg-card/90 px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-70 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          aria-label="Expand diagram"
        >
          <Maximize2 className="size-3.5" />
          Expand
        </button>
      )}

      <div
        className={['overflow-x-auto p-4', expanded ? 'flex-1' : ''].join(' ')}
      >
        {svg ? (
          <div
            className="flex min-w-fit justify-center [&_svg]:h-auto [&_svg]:max-w-none"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading diagram...</div>
        )}
      </div>
    </div>
  );
}
