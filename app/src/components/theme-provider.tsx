"use client";

import * as React from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";

const THEME_STORAGE_KEY = "supercheck-theme";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props} storageKey={THEME_STORAGE_KEY}>
      {children}
    </NextThemesProvider>
  );
}
