import { codeToHtml } from "shiki";

/**
 * Editor-style code panel, highlighted at build time. It stays dark in both
 * site themes, like a code editor, so the code reads as code.
 */
export async function CodeWindow({ code, filename, lang = "ts" }: { code: string; filename: string; lang?: string }) {
  const html = await codeToHtml(code, {
    lang,
    theme: "github-dark-default",
    transformers: [
      {
        pre(node) {
          node.properties.class = "code-window__pre";
          delete node.properties.style;
          delete node.properties.tabindex;
        },
      },
    ],
  });

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-[#0d1117] shadow-[0_24px_48px_-24px_rgb(0_0_0/0.45)] dark:border-fd-border">
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#161b22] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="font-mono text-xs text-zinc-400">{filename}</span>
      </div>
      <div className="code-window overflow-x-auto py-4 font-mono text-[13px] leading-relaxed focus-visible:outline-2 focus-visible:outline-fd-primary" role="region" aria-label={filename} tabIndex={0} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
