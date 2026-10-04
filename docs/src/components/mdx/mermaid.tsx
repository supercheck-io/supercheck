'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

export function Mermaid({ chart }: { chart: string }): ReactElement {
  const id = useId();
  const renderGeneration = useRef(0);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const renderId = `${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${++renderGeneration.current}`;

    // Dynamically import mermaid only on client-side
    import('mermaid').then(async (mermaidModule) => {
      if (cancelled) return;
      const mermaid = mermaidModule.default;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        fontFamily: 'inherit',
      });

      const result = await mermaid.render(renderId, chart);
      if (!cancelled) {
        setSvg(result.svg);
        setFailed(false);
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.error('Mermaid rendering error:', error);
      setFailed(true);
    });
    return () => { cancelled = true; };
  }, [id, chart, resolvedTheme]);

  if (failed || !svg) {
    return (
      <div className="my-4 flex flex-col items-center rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground" role="status">
          {failed ? 'Diagram unavailable. Reload the page to try again.' : 'Loading diagram...'}
        </div>
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
