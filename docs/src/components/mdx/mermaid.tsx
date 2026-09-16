'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useState, type ReactElement } from 'react';

export function Mermaid({ chart }: { chart: string }): ReactElement {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');

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
        // Render at the diagram's natural size so labels stay readable; wide
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

  return (
    <div className="my-4 rounded-lg border bg-card">
      <div className="overflow-x-auto p-4">
        {svg ? (
          <div
            className="flex w-max min-w-full justify-center [&_svg]:h-auto [&_svg]:max-w-none"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading diagram...</div>
        )}
      </div>
    </div>
  );
}
