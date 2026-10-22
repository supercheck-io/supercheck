/**
 * Monaco Editor Configuration Utilities
 *
 * CENTRALIZED CONFIGURATION for Monaco Editor across the application.
 * Eliminates duplicate theme definitions and provides consistent settings.
 *
 * This module follows DRY principles by providing:
 * - Single source of truth for Monaco themes
 * - Shared editor options factory
 * - Idempotent theme registration
 *
 * @example
 * ```typescript
 * import { registerMonacoThemes, getMonacoTheme, getBaseEditorOptions } from '@/lib/monaco-config';
 *
 * // In beforeMount callback
 * beforeMount={(monaco) => registerMonacoThemes(monaco)}
 *
 * // For theme prop
 * theme={getMonacoTheme(resolvedTheme)}
 *
 * // For options prop
 * options={getBaseEditorOptions({ minimap: { enabled: true } })}
 * ```
 */

import type { editor } from "monaco-editor";

// ============================================================================
// THEME CONSTANTS
// ============================================================================

/**
 * Monaco theme identifiers used throughout the application
 */
export const MONACO_THEMES = {
  LIGHT: "warm-light",
  DARK: "vs-dark",
} as const;

/**
 * Custom warm-light theme definition for light mode
 * Provides a softer, cream-colored background for better readability
 */
export const WARM_LIGHT_THEME: editor.IStandaloneThemeData = {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#FAF7F3",
  },
};

// ============================================================================
// INTERNAL STATE
// ============================================================================

/**
 * Flag to ensure themes are only registered once per Monaco instance
 * Prevents duplicate theme registration warnings
 */
let themesRegistered = false;

// ============================================================================
// THEME FUNCTIONS
// ============================================================================

/**
 * Get the appropriate Monaco theme based on resolved theme
 *
 * @param resolvedTheme - The resolved theme from next-themes (light/dark/system)
 * @returns Monaco theme identifier
 *
 * @example
 * ```typescript
 * const { resolvedTheme } = useTheme();
 * const editorTheme = getMonacoTheme(resolvedTheme);
 * ```
 */
export function getMonacoTheme(resolvedTheme: string | undefined): string {
  return resolvedTheme === "dark" ? MONACO_THEMES.DARK : MONACO_THEMES.LIGHT;
}

/**
 * Monaco instance type for theme registration
 */
type MonacoInstance = typeof import("monaco-editor");

/**
 * Register custom Monaco themes
 *
 * This function is idempotent - safe to call multiple times.
 * Should be called in the editor's beforeMount callback.
 *
 * @param monaco - Monaco instance from @monaco-editor/react
 *
 * @example
 * ```tsx
 * <Editor
 *   beforeMount={(monaco) => registerMonacoThemes(monaco)}
 *   // ...
 * />
 * ```
 */
export function registerMonacoThemes(monaco: MonacoInstance): void {
  if (themesRegistered) return;

  try {
    monaco.editor.defineTheme(MONACO_THEMES.LIGHT, WARM_LIGHT_THEME);
    themesRegistered = true;
  } catch (error) {
    // Theme already defined by another component - safe to ignore
    console.debug("[Monaco Config] Theme already registered:", error);
    themesRegistered = true;
  }
}

/**
 * Reset theme registration flag (for testing only)
 * @internal
 */
export function _resetThemeRegistration(): void {
  themesRegistered = false;
}

// ============================================================================
// EDITOR OPTIONS
// ============================================================================

/**
 * Base editor options shared across all Monaco instances
 * Provides consistent UX and optimal performance settings
 */
const BASE_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  scrollBeyondLastLine: false,
  wordWrap: "on",
  fontSize: 13,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  minimap: { enabled: false },
  scrollbar: {
    vertical: "auto",
    horizontal: "auto",
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: true,
  },
  padding: { top: 16, bottom: 16 },
  renderWhitespace: "none",
  smoothScrolling: true,
};

/**
 * Get base editor options with optional overrides
 *
 * @param overrides - Partial options to merge with base options
 * @returns Complete editor options object
 *
 * @example
 * ```typescript
 * // Use default options
 * options={getBaseEditorOptions()}
 *
 * // Override specific options
 * options={getBaseEditorOptions({
 *   minimap: { enabled: true },
 *   readOnly: true,
 * })}
 * ```
 */
export function getBaseEditorOptions(
  overrides?: Partial<editor.IStandaloneEditorConstructionOptions>
): editor.IStandaloneEditorConstructionOptions {
  if (!overrides) return { ...BASE_EDITOR_OPTIONS };

  return {
    ...BASE_EDITOR_OPTIONS,
    ...overrides,
    // Deep merge for nested objects
    scrollbar: {
      ...BASE_EDITOR_OPTIONS.scrollbar,
      ...(overrides.scrollbar || {}),
    },
    minimap: {
      ...BASE_EDITOR_OPTIONS.minimap,
      ...(overrides.minimap || {}),
    },
    padding: {
      ...BASE_EDITOR_OPTIONS.padding,
      ...(overrides.padding || {}),
    },
  };
}

/**
 * Playground-specific editor options
 * Extends base options with features for interactive code editing
 */
export const PLAYGROUND_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions =
  getBaseEditorOptions({
    fontSize: 13.5,
    roundedSelection: true,
    folding: true,
    renderValidationDecorations: "off",
    hover: { enabled: true },
    suggest: {
      snippetsPreventQuickSuggestions: false,
      showIcons: true,
      showStatusBar: true,
      preview: true,
      filterGraceful: true,
      selectionMode: "always",
      showMethods: true,
      showFunctions: true,
      showConstructors: true,
      showDeprecated: false,
      matchOnWordStartOnly: false,
      localityBonus: true,
    },
    parameterHints: {
      enabled: true,
      cycle: true,
    },
    inlineSuggest: {
      enabled: true,
    },
    quickSuggestions: {
      other: true,
      comments: true,
      strings: true,
    },
    acceptSuggestionOnCommitCharacter: true,
    acceptSuggestionOnEnter: "on",
    tabCompletion: "on",
    wordBasedSuggestions: "currentDocument",
  });

/**
 * Read-only viewer options
 * Optimized for displaying code without editing capabilities
 */
export const VIEWER_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions =
  getBaseEditorOptions({
    readOnly: true,
    lineNumbers: "off",
    folding: true,
    contextmenu: false,
    renderLineHighlight: "none",
  });
