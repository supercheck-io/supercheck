"use client";

import { useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type LineStyle = "error" | "warn" | "success" | "info";

const styleMap: Record<LineStyle, string> = {
  error: "text-red-400 dark:text-red-300",
  warn: "text-amber-500 dark:text-amber-400",
  success: "text-emerald-500 dark:text-emerald-400",
  info: "text-slate-600 dark:text-slate-300",
};

const weightMap: Record<LineStyle, string> = {
  error: "font-semibold",
  warn: "font-semibold",
  success: "font-medium",
  info: "font-normal",
};

const classifyLine = (line: string): LineStyle => {
  const normalized = line.toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("panic") ||
    normalized.includes("fatal")
  ) {
    return "error";
  }
  if (normalized.includes("warn")) {
    return "warn";
  }
  if (
    normalized.includes("threshold") &&
    (normalized.includes("passed") || normalized.includes("satisfied"))
  ) {
    return "success";
  }
  return "info";
};

export interface ConsoleViewerProps {
  content: string;
  className?: string;
  emptyMessage?: string;
}

export function ConsoleViewer({
  content,
  className,
  emptyMessage = "Console output will appear here once available.",
}: ConsoleViewerProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content]);

  const renderedLines = useMemo(() => {
    if (!content) {
      return (
        <div className="text-xs text-muted-foreground/60 italic py-2">
          {emptyMessage}
        </div>
      );
    }

    return content.split(/\r?\n/).map((line, idx) => {
      if (!line.trim()) {
        return <div key={`line-${idx}`} className="h-2" />;
      }

      const variant = classifyLine(line);
      const getPrefix = () => {
        if (variant === "error") return "✕ ";
        if (variant === "warn") return "⚠ ";
        if (variant === "success") return "✓ ";
        return "";
      };

      return (
        <div
          key={`line-${idx}`}
          className={cn(
            "whitespace-pre-wrap break-words py-0.5",
            styleMap[variant],
            weightMap[variant],
            variant === "info" && "opacity-85"
          )}
        >
          {variant !== "info" && <span className="mr-1">{getPrefix()}</span>}
          {line}
        </div>
      );
    });
  }, [content, emptyMessage]);

  return (
    <div
      className={cn(
        "h-full overflow-hidden rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm",
        className,
      )}
    >
      <ScrollArea className="h-full">
        <div className="p-4 text-[13px] font-mono leading-relaxed">
          {renderedLines}
        </div>
        <div ref={bottomRef} />
      </ScrollArea>
    </div>
  );
}
