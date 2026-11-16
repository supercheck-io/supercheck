import type { languages } from "monaco-editor";

export async function loadPlaywrightEditorTypes(
  defaults: Pick<languages.typescript.LanguageServiceDefaults, "getExtraLibs" | "addExtraLib">
) {
  if (defaults.getExtraLibs()["file:///node_modules/@playwright/test/index.d.ts"]) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("/playwright-types.json");
      if (!response.ok) throw new Error("Failed to load Playwright editor types");
      const bundle: { files: Record<string, string> } = await response.json();
      for (const [uri, content] of Object.entries(bundle.files)) {
        defaults.addExtraLib(content, uri);
      }
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

// Types for '@supercheck/agent-test', served like public/supercheck.d.ts; worker agent-test-types.spec.ts keeps it in sync.
export async function loadAgentTestEditorTypes(
  defaults: Pick<languages.typescript.LanguageServiceDefaults, "getExtraLibs" | "addExtraLib">
) {
  const uri = "file:///node_modules/@supercheck/agent-test/index.d.ts";
  if (defaults.getExtraLibs()[uri]) return;
  const response = await fetch("/agent-test-types.d.ts");
  if (!response.ok) throw new Error("Failed to load agent test editor types");
  defaults.addExtraLib(await response.text(), uri);
}
