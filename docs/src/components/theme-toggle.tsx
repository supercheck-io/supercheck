"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className }: { className?: string } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Same box before and after mount so the header does not shift.
  const buttonClass =
    className ??
    "-m-1.5 rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";
  const iconClass = className ? "size-[18px]" : "size-5";

  if (!isMounted) {
    return (
      <span className={buttonClass} aria-hidden="true">
        <span className={`block ${iconClass}`} />
      </span>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={buttonClass}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className={iconClass} /> : <Moon className={iconClass} />}
    </button>
  );
}
