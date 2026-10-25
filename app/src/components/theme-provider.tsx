"use client";

import * as React from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";

const THEME_STORAGE_KEY = "supercheck-theme";

// The theme script must run from the server HTML before paint. On the client React would warn about
// re-rendering an executable <script>, so mark it inert there; it has already run.
const scriptProps =
  typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props} storageKey={THEME_STORAGE_KEY} scriptProps={scriptProps}>
      {children}
    </NextThemesProvider>
  );
}
