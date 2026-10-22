import type { typescript } from "monaco-editor";

export async function loadPlaywrightEditorTypes(
  defaults: Pick<typescript.LanguageServiceDefaults, "getExtraLibs" | "addExtraLib">
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
