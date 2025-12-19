import {
  forwardRef,
  useEffect,
  useCallback,
  useRef,
  memo,
  useState,
} from "react";
import { Editor, useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Maximize2, X } from "lucide-react";
import { useMonacoPerformance } from "./use-monaco-performance";
import { getCachedTypeDefs } from "@/components/monaco-prefetcher";

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
}

// Use the memo HOC to prevent unnecessary re-renders
export const MonacoEditorClient = memo(
  forwardRef<editor.IStandaloneCodeEditor, MonacoEditorProps>(
    ({ value, onChange }, ref) => {
      const monaco = useMonaco();
      const { resolvedTheme } = useTheme();
      const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(
        null
      );
      const fullscreenEditorRef = useRef<editor.IStandaloneCodeEditor | null>(
        null
      );
      const styleSheetRef = useRef<HTMLStyleElement | null>(null);
      const isInitialized = useRef(false);
      const [showFullscreen, setShowFullscreen] = useState(false);
      // Store the editor instance in state to safely pass to hooks without reading refs during render
      const [editorInstance, setEditorInstance] =
        useState<editor.IStandaloneCodeEditor | null>(null);

      // Performance monitoring hook - uses state-based editor instance (not ref)
      useMonacoPerformance(editorInstance);

      // Handle keyboard navigation for fullscreen
      useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (showFullscreen && event.key === "Escape") {
            setShowFullscreen(false);
          }
        };

        if (showFullscreen) {
          document.addEventListener("keydown", handleKeyDown);
          // Prevent body scroll when fullscreen is open
          document.body.style.overflow = "hidden";
        } else {
          document.body.style.overflow = "";
        }

        return () => {
          document.removeEventListener("keydown", handleKeyDown);
          document.body.style.overflow = "";
        };
      }, [showFullscreen]);

      // Update editor theme when app theme changes
      useEffect(() => {
        if (monaco) {
          const editorTheme =
            resolvedTheme === "dark" ? "vs-dark" : "warm-light";
          monaco.editor.setTheme(editorTheme);
        }
      }, [resolvedTheme, monaco]);

      // Configure Monaco once when it's available
      useEffect(() => {
        if (!monaco || isInitialized.current) return;

        // Mark as initialized to prevent configuration on re-renders
        isInitialized.current = true;

        // Set eager model sync for immediate type loading
        monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);

        // Configure JavaScript defaults
        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
          target: monaco.languages.typescript.ScriptTarget.ESNext,
          allowNonTsExtensions: true,
          moduleResolution:
            monaco.languages.typescript.ModuleResolutionKind.NodeJs,
          module: monaco.languages.typescript.ModuleKind.ESNext,
          noEmit: true,
          esModuleInterop: true,
          allowJs: true,
          checkJs: true,
          strict: true,
          noImplicitAny: false,
          strictNullChecks: true,
          strictFunctionTypes: true,
          strictBindCallApply: true,
          strictPropertyInitialization: true,
          noImplicitThis: true,
          alwaysStrict: true,
        });

        // Enable diagnostics and suggestions
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
          noSuggestionDiagnostics: false,
          diagnosticCodesToIgnore: [],
        });

        // Load enhanced type definitions with secure error handling
        // PERFORMANCE: Uses cached types from MonacoPrefetcher if available
        const loadTypeDefinitions = async () => {
          try {
            // Load comprehensive Supercheck types (includes all Playwright types)
            const typeFiles = [
              {
                path: "/supercheck.d.ts",
                uri: "file:///types/supercheck.d.ts",
                name: "Supercheck",
              },
            ];

            for (const typeFile of typeFiles) {
              try {
                // PERFORMANCE: Try to use cached type definitions first
                let typeContent = getCachedTypeDefs();

                if (!typeContent) {
                  // Fall back to fetching if not cached
                  const response = await fetch(typeFile.path);
                  if (!response.ok) {
                    console.error(
                      `Failed to fetch ${typeFile.name} types: ${response.status}`
                    );
                    continue;
                  }
                  typeContent = await response.text();
                }
                if (!typeContent || typeContent.trim().length === 0) {
                  console.warn(`Empty content for ${typeFile.name} types`);
                  continue;
                }

                // Validate content is not malicious (basic check)
                if (
                  typeContent.includes("<script") ||
                  typeContent.includes("eval(")
                ) {
                  console.error(
                    `${typeFile.name} types contain potentially malicious content`
                  );
                  continue;
                }

                const uri = monaco.Uri.parse(typeFile.uri);
                const existingModel = monaco.editor.getModel(uri);

                if (!existingModel) {
                  // Create a new model for the type definitions
                  const model = monaco.editor.createModel(
                    typeContent,
                    "typescript",
                    uri
                  );

                  // Add to JavaScript defaults for IntelliSense
                  monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    model.getValue(),
                    model.uri.toString()
                  );
                } else {
                  // Update existing model
                  existingModel.setValue(typeContent);
                  monaco.languages.typescript.javascriptDefaults.addExtraLib(
                    typeContent,
                    uri.toString()
                  );
                }
              } catch (fileError) {
                console.error(
                  `Error loading ${typeFile.name} types:`,
                  fileError
                );
              }
            }
          } catch (error) {
            console.error("Error in loadTypeDefinitions:", error);
          }
        };

        // Load type definitions
        loadTypeDefinitions();

        // Register enhanced hover documentation
        const registerEnhancements = () => {
          try {
            // Register hover provider for enhanced documentation
            monaco.languages.registerHoverProvider("typescript", {
              provideHover: (model, position) => {
                const word = model.getWordAtPosition(position);
                if (!word) return null;

                const hoverContent = {
                  getVariable: {
                    contents: [
                      { value: "**getVariable(key: string, options?): T**" },
                      {
                        value:
                          "Retrieves a project variable value with type safety.",
                      },
                      {
                        value:
                          "\\n**Security:** Regular variables are stored in plain text and can be logged.",
                      },
                      {
                        value:
                          "\\n**Example:**\\n```typescript\\nconst baseUrl = getVariable('BASE_URL');\\nconst timeout = getVariable('TIMEOUT', { type: 'number', default: 5000 });\\n```",
                      },
                    ],
                  },
                  getSecret: {
                    contents: [
                      {
                        value:
                          "**getSecret(key: string, options?): ProtectedSecret | T**",
                      },
                      {
                        value:
                          "Retrieves a project secret with enhanced security protection.",
                      },
                      {
                        value:
                          "\\n**Security:** Secrets are encrypted at rest and protected from console logging.",
                      },
                      {
                        value:
                          "\\n**Example:**\\n```typescript\\nconst password = getSecret('PASSWORD');\\nconst apiKey = getSecret('API_KEY', { type: 'string' });\\n```",
                      },
                    ],
                  },
                };

                const content =
                  hoverContent[word.word as keyof typeof hoverContent];
                if (content) {
                  return {
                    range: new monaco.Range(
                      position.lineNumber,
                      word.startColumn,
                      position.lineNumber,
                      word.endColumn
                    ),
                    contents: content.contents,
                  };
                }

                return null;
              },
            });

            // Register additional hover provider for ProtectedSecret interface
            monaco.languages.registerHoverProvider("typescript", {
              provideHover: (model, position) => {
                const word = model.getWordAtPosition(position);
                if (!word || word.word !== "ProtectedSecret") return null;

                return {
                  range: new monaco.Range(
                    position.lineNumber,
                    word.startColumn,
                    position.lineNumber,
                    word.endColumn
                  ),
                  contents: [
                    { value: "### ProtectedSecret Interface" },
                    {
                      value:
                        "Enterprise-grade secret protection that prevents accidental exposure.",
                    },
                    { value: "---" },
                    { value: "**Protection Mechanisms:**" },
                    { value: '• `toString()` → Returns "[SECRET]"' },
                    { value: '• `toJSON()` → Returns "[SECRET]"' },
                    {
                      value:
                        "• `valueOf()` → Returns actual secret value for APIs",
                    },
                    { value: "• `Symbol.toPrimitive` → Safe type coercion" },
                    {
                      value:
                        "• `util.inspect` protection for Node.js debugging",
                    },
                    { value: "---" },
                    { value: "**Usage:**" },
                    { value: "```typescript" },
                    { value: "const secret = getSecret('API_TOKEN');" },
                    { value: 'console.log(secret);           // "[SECRET]"' },
                    { value: 'String(secret);               // "[SECRET]"' },
                    {
                      value:
                        'JSON.stringify({secret});     // {"secret":"[SECRET]"}',
                    },
                    { value: "" },
                    { value: "// But works perfectly with APIs:" },
                    { value: "fetch(url, {" },
                    {
                      value:
                        '  headers: { "Authorization": `Bearer ${secret}` }',
                    },
                    { value: "});" },
                    { value: "```" },
                  ],
                };
              },
            });
          } catch (error) {
            console.error("Error registering Monaco enhancements:", error);
          }
        };

        // Register enhancements after a short delay to ensure Monaco is fully initialized
        setTimeout(registerEnhancements, 100);
      }, [monaco]);

      // Cleanup function to dispose of providers when component unmounts
      useEffect(() => {
        return () => {
          // Dispose of editor instances to prevent memory leaks
          if (editorInstanceRef.current) {
            try {
              editorInstanceRef.current.dispose();
            } catch (error) {
              console.warn(
                "[Monaco Editor] Error disposing main editor:",
                error
              );
            }
            editorInstanceRef.current = null;
          }
          if (fullscreenEditorRef.current) {
            try {
              fullscreenEditorRef.current.dispose();
            } catch (error) {
              console.warn(
                "[Monaco Editor] Error disposing fullscreen editor:",
                error
              );
            }
            fullscreenEditorRef.current = null;
          }

          // Clean up custom styles
          if (styleSheetRef.current && styleSheetRef.current.parentNode) {
            try {
              styleSheetRef.current.parentNode.removeChild(
                styleSheetRef.current
              );
            } catch (error) {
              console.warn("[Monaco Editor] Error removing styles:", error);
            }
            styleSheetRef.current = null;
          }

          // Reset initialization flag
          isInitialized.current = false;
        };
      }, []);

      // Add custom styles to remove all borders, but only once
      const beforeMount = useCallback(
        (monaco: typeof import("monaco-editor")) => {
          // Define custom warm light theme before editor mounts
          monaco.editor.defineTheme("warm-light", {
            base: "vs",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#FAF7F3",
            },
          });

          // Check if the style already exists by ID
          if (!document.getElementById("monaco-editor-styles")) {
            const styleSheet = document.createElement("style");
            styleSheet.id = "monaco-editor-styles";
            styleSheet.textContent = `
        .monaco-editor, .monaco-editor-background, .monaco-editor .margin,
        .monaco-workbench .part.editor>.content .editor-group-container>.title,
        .monaco-workbench .part.editor>.content .editor-group-container,
        .monaco-editor .overflow-guard {
          border: none !important;
          outline: none !important;
        }
        .overflow-guard {
          border-bottom: none !important;
        }
      `;
            document.head.appendChild(styleSheet);
            styleSheetRef.current = styleSheet;
          }
        },
        []
      );

      // Handle editor mount - this should only happen once
      const handleEditorMount = useCallback(
        (editor: editor.IStandaloneCodeEditor) => {
          // Store the editor instance in our ref (for imperative access)
          editorInstanceRef.current = editor;

          // Store in state for performance monitoring hook (avoids reading ref during render)
          setEditorInstance(editor);

          // Set the ref passed from the parent
          if (ref && typeof ref === "object") {
            ref.current = editor;
          }

          // Configuration will be handled by the main options prop
        },
        [ref]
      );

      // Handle fullscreen editor mount
      const handleFullscreenEditorMount = useCallback(
        (editor: editor.IStandaloneCodeEditor) => {
          fullscreenEditorRef.current = editor;
        },
        []
      );

      // Create a memoized callback for onChange to prevent unnecessary re-renders
      const handleEditorChange = useCallback(
        (value: string | undefined) => {
          onChange(value);
        },
        [onChange]
      );

      return (
        <>
          <div
            className="flex flex-1 w-full relative overflow-hidden border border-border rounded-bl-lg monaco-wrapper"
            role="application"
            aria-label="Code editor"
            aria-describedby="editor-help"
          >
            {/* Fullscreen button */}
            <div className="absolute top-2 right-2 z-10">
              <Button
                size="sm"
                className="cursor-pointer flex items-center gap-1 bg-secondary hover:bg-secondary/90"
                onClick={() => setShowFullscreen(true)}
                aria-label="Open editor in fullscreen mode"
                title="Open editor in fullscreen mode"
              >
                <Maximize2 className="h-4 w-4 text-secondary-foreground" />
              </Button>
            </div>

            {/* Screen reader help text */}
            <div id="editor-help" className="sr-only">
              Code editor with JavaScript/TypeScript support. Use Tab to
              navigate, Ctrl+Space for autocomplete, and Ctrl+/ for comments.
            </div>

            <Editor
              height="calc(100vh - 10rem)"
              defaultLanguage="typescript"
              value={value}
              onChange={handleEditorChange}
              theme={resolvedTheme === "dark" ? "vs-dark" : "warm-light"}
              className="w-full overflow-hidden"
              beforeMount={beforeMount}
              onMount={handleEditorMount}
              aria-label="TypeScript code editor"
              options={{
                minimap: { enabled: false },
                fontSize: 13.5,
                wordWrap: "on",
                padding: { top: 16, bottom: 16 },
                automaticLayout: true,
                roundedSelection: true,
                scrollBeyondLastLine: false,
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
              }}
            />
          </div>

          {/* Manual fullscreen implementation */}
          {showFullscreen && (
            <div
              className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fullscreen-editor-title"
            >
              <div className="fixed inset-8 bg-card rounded-lg shadow-lg flex flex-col overflow-hidden border">
                <div className="p-4 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg
                      className="h-7 w-7"
                      xmlns="http://www.w3.org/2000/svg"
                      x="0px"
                      y="0px"
                      width="96"
                      height="96"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <path fill="#ffd600" d="M6,42V6h36v36H6z"></path>
                      <path
                        fill="#000001"
                        d="M29.538 32.947c.692 1.124 1.444 2.201 3.037 2.201 1.338 0 2.04-.665 2.04-1.585 0-1.101-.726-1.492-2.198-2.133l-.807-.344c-2.329-.988-3.878-2.226-3.878-4.841 0-2.41 1.845-4.244 4.728-4.244 2.053 0 3.528.711 4.592 2.573l-2.514 1.607c-.553-.988-1.151-1.377-2.078-1.377-.946 0-1.545.597-1.545 1.377 0 .964.6 1.354 1.985 1.951l.807.344C36.452 29.645 38 30.839 38 33.523 38 36.415 35.716 38 32.65 38c-2.999 0-4.702-1.505-5.65-3.368L29.538 32.947zM17.952 33.029c.506.906 1.275 1.603 2.381 1.603 1.058 0 1.667-.418 1.667-2.043V22h3.333v11.101c0 3.367-1.953 4.899-4.805 4.899-2.577 0-4.437-1.746-5.195-3.368L17.952 33.029z"
                      ></path>
                    </svg>
                    <h2
                      id="fullscreen-editor-title"
                      className="text-xl font-semibold"
                    >
                      Editor
                    </h2>
                  </div>
                  <Button
                    className="cursor-pointer bg-secondary hover:bg-secondary/90"
                    size="sm"
                    onClick={() => setShowFullscreen(false)}
                    aria-label="Close fullscreen editor"
                    title="Close fullscreen editor (Escape)"
                  >
                    <X className="h-4 w-4 text-secondary-foreground" />
                  </Button>
                </div>
                <div className="flex-grow overflow-hidden">
                  <Editor
                    height="100%"
                    defaultLanguage="typescript"
                    value={value}
                    onChange={handleEditorChange}
                    theme={resolvedTheme === "dark" ? "vs-dark" : "warm-light"}
                    className="w-full h-full"
                    beforeMount={beforeMount}
                    onMount={handleFullscreenEditorMount}
                    aria-label="Fullscreen TypeScript code editor"
                    options={{
                      minimap: { enabled: true }, // Enable minimap in fullscreen
                      fontSize: 14,
                      wordWrap: "on",
                      padding: { top: 16, bottom: 16 },
                      automaticLayout: true,
                      roundedSelection: true,
                      scrollBeyondLastLine: false,
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
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      );
    }
  )
);

// Add displayName for better debugging and to fix the ESLint warning
MonacoEditorClient.displayName = "MonacoEditorClient";
