'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

export function Mermaid({ chart }: { chart: string }): ReactElement {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current || typeof window === 'undefined') return;
    hasRun.current = true;

    // Dynamically import mermaid only on client-side
    import('mermaid').then((mermaidModule) => {
      const mermaid = mermaidModule.default;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
      });

      mermaid
        .render(id, chart)
        .then((result) => setSvg(result.svg))
        .catch((e) => {
          console.error('Mermaid rendering error:', e);
          hasRun.current = false;
        });
    });
  }, [id, chart, resolvedTheme]);

  if (!svg) {
    return (
      <div className="my-4 flex flex-col items-center rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground">Loading diagram...</div>
      </div>
    );
  }

  return (
    <div
      className="my-4 flex flex-col items-center rounded-lg border bg-card p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
