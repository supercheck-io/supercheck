"use client";

import { useLayoutEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface TruncatedTextWithTooltipProps {
  text: string;
  /** Initial guess before the rendered width is measured (and the fallback without ResizeObserver). */
  maxLength?: number;
  className?: string;
  maxWidth?: string;
  showTooltipOnTruncation?: boolean;
}

export function TruncatedTextWithTooltip({
  text,
  maxLength = 20,
  className = "",
  maxWidth = "160px",
  showTooltipOnTruncation = true,
}: TruncatedTextWithTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isTruncated, setIsTruncated] = useState(text.length > maxLength);
  // Callback ref: the two branches below render different elements, so re-measure whichever is mounted.
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    // Show the popover exactly when the text is clipped, whatever its character count.
    const measure = () => setIsTruncated(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);

  if (!showTooltipOnTruncation || !isTruncated) {
    return (
      <div ref={setElement} className={`truncate ${className}`} style={{ maxWidth }}>
        {text}
      </div>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          ref={setElement}
          className={`cursor-pointer truncate ${className}`}
          style={{ maxWidth }}
          // Clipped text is a tab stop so keyboard users can open the full text too.
          tabIndex={0}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
        >
          {text}
        </div>
      </PopoverTrigger>
      <PopoverContent className="flex justify-center items-center w-auto max-w-[500px] min-w-0">
        <div className="space-y-2 min-w-0">
          <p className="text-xs text-muted-foreground break-words">
            {text}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
