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
      const isSequence = /^\s*sequenceDiagram\b/m.test(chart);
      const dark = resolvedTheme === 'dark';

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: 'inherit',
      });
      const sequenceConfig = {
        theme: 'base',
        sequence: {
          mirrorActors: false,
          actorMargin: 70,
          width: 190,
          height: 64,
          messageMargin: 36,
          noteMargin: 16,
          wrap: true,
          useMaxWidth: true,
        },
        themeVariables: {
          darkMode: dark,
          actorBkg: '#1d4ed8',
          actorBorder: '#3b82f6',
          actorTextColor: '#ffffff',
          actorLineColor: dark ? '#64748b' : '#94a3b8',
          signalColor: dark ? '#93c5fd' : '#1d4ed8',
          signalTextColor: dark ? '#e2e8f0' : '#1e293b',
          labelBoxBkgColor: dark ? '#2e1065' : '#ede9fe',
          labelBoxBorderColor: '#8b5cf6',
          labelTextColor: dark ? '#ddd6fe' : '#5b21b6',
          loopTextColor: dark ? '#ddd6fe' : '#5b21b6',
          noteBkgColor: dark ? '#422006' : '#fef3c7',
          noteBorderColor: '#d97706',
          noteTextColor: dark ? '#fde68a' : '#78350f',
          sequenceNumberColor: dark ? '#0f172a' : '#ffffff',
        },
        themeCSS: `
          g[data-id="You"] rect.actor { fill: #6d28d9 !important; stroke: #8b5cf6 !important; }
          g[data-id="Environment"] rect.actor { fill: #047857 !important; stroke: #10b981 !important; }
          text.actor { fill: #ffffff !important; font-weight: 600; }
          .actor-line { stroke-dasharray: 4 6; }
          .messageLine0, .messageLine1 { stroke-width: 1.5; }
          .messageText, .noteText { font-size: 16px !important; }
        `,
      };

      const styledChart = isSequence
        ? `%%{init: ${JSON.stringify(sequenceConfig)}}%%\n${chart}`
        : chart;
      const result = await mermaid.render(renderId, styledChart);
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
