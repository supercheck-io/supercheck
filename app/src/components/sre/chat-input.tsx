"use client";

import { CornerDownLeft, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SreChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  placeholder: string;
  submitLabel?: string;
  footer?: string;
  helperLabel?: string;
};

export function SreChatInput({
  value,
  onChange,
  onSubmit,
  isPending,
  placeholder,
  submitLabel = "Ask SRE AI",
  footer,
  helperLabel = "Read-only",
}: SreChatInputProps) {
  return (
    <div className="rounded-2xl border bg-background/95 p-2 shadow-sm">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={isPending}
        onKeyDown={(event) => {
          const isComposing = event.nativeEvent.isComposing;
          if (event.key === "Enter" && !event.shiftKey && !isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="min-h-16 max-h-32 resize-none border-0 bg-transparent shadow-none [scrollbar-width:none] focus-visible:ring-0 [&::-webkit-scrollbar]:hidden"
      />
      <div className="flex flex-col gap-2 border-t px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/30 px-2 py-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {helperLabel}
          </span>
          {footer && <span>{footer}</span>}
          <span className="hidden sm:inline">Enter to send · Shift+Enter for newline</span>
        </div>
        <Button onClick={onSubmit} disabled={isPending || !value.trim()} className="h-9 sm:min-w-28">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
          {!isPending && <CornerDownLeft className="ml-2 h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
