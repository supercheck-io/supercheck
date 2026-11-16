"use client";

import { useState } from "react";
import { Info, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Info popover beside the Variables title: the helper functions available in scripts. */
export function VariablesHelp() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      toast.error("Failed to copy code");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="About variables, secrets and files">
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(480px,calc(100vw-2rem))]" side="bottom" align="start">
        <div className="space-y-3">
          <div>
            <h3 className="font-medium text-sm">
              Variables, Secrets & Files
            </h3>
            <p className="text-xs text-muted-foreground">
              Four helper functions available in Playwright and k6
              scripts.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-foreground">getVariable(key, options?)</h4>
              <p className="text-xs text-muted-foreground">
                Plain-text config — URLs, timeouts, feature flags.
              </p>
              <div className="relative bg-muted p-2.5 rounded border border-muted-foreground/20">
                <pre className="font-mono text-[11px] overflow-auto text-foreground pr-7 leading-relaxed">{`const baseUrl = getVariable('BASE_URL');
const timeout = getVariable('TIMEOUT', {
  type: 'number', default: 5000
});
await page.goto(baseUrl);`}</pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-1.5 right-1.5 h-5 w-5 p-0"
                  onClick={() =>
                    handleCopyCode(`const baseUrl = getVariable('BASE_URL');\nconst timeout = getVariable('TIMEOUT', { type: 'number', default: 5000 });\nawait page.goto(baseUrl);`)
                  }
                >
                  {copiedCode ===
                    `const baseUrl = getVariable('BASE_URL');\nconst timeout = getVariable('TIMEOUT', { type: 'number', default: 5000 });\nawait page.goto(baseUrl);` ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-foreground">getSecret(key, options?)</h4>
              <p className="text-xs text-muted-foreground">
                Encrypted values — API keys, passwords, tokens. Output is auto-redacted.
              </p>
              <div className="relative bg-muted p-2.5 rounded border border-muted-foreground/20">
                <pre className="font-mono text-[11px] overflow-auto text-foreground pr-7 leading-relaxed">{`const password = getSecret('PASSWORD');
const apiKey = getSecret('API_KEY');
await page.fill('[name="password"]', password);
await page.setExtraHTTPHeaders({
  Authorization: \`Bearer \${apiKey}\`
});`}</pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-1.5 right-1.5 h-5 w-5 p-0"
                  onClick={() =>
                    handleCopyCode(`const password = getSecret('PASSWORD');\nconst apiKey = getSecret('API_KEY');\nawait page.fill('[name=\"password\"]', password);\nawait page.setExtraHTTPHeaders({\n  Authorization: \`Bearer \${apiKey}\`\n});`)
                  }
                >
                  {copiedCode ===
                    `const password = getSecret('PASSWORD');\nconst apiKey = getSecret('API_KEY');\nawait page.fill('[name=\"password\"]', password);\nawait page.setExtraHTTPHeaders({\n  Authorization: \`Bearer \${apiKey}\`\n});` ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-foreground">File Helpers</h4>
              <p className="text-xs text-muted-foreground">
                Use <code className="text-[10px] bg-background px-1 rounded">readFile(key)</code> in Playwright, or <code className="text-[10px] bg-background px-1 rounded">open(getFile(key))</code> in k6 init context.
              </p>
              <div className="relative bg-muted p-2.5 rounded border border-muted-foreground/20">
                <pre className="font-mono text-[11px] overflow-auto text-foreground pr-7 leading-relaxed">{`// Playwright
const playwrightCsvContent = readFile('USERS_CSV');

// k6 (init context)
const k6CsvContent = open(getFile('USERS_CSV'));`}</pre>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-1.5 right-1.5 h-5 w-5 p-0"
                  onClick={() =>
                    handleCopyCode(`// Playwright\nconst playwrightCsvContent = readFile('USERS_CSV');\n\n// k6 (init context)\nconst k6CsvContent = open(getFile('USERS_CSV'));`)
                  }
                >
                  {copiedCode ===
                    `// Playwright\nconst playwrightCsvContent = readFile('USERS_CSV');\n\n// k6 (init context)\nconst k6CsvContent = open(getFile('USERS_CSV'));` ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground border-t pt-2">
              <strong>Tip:</strong> Variables for config, secrets
              for sensitive data, files for test datasets. Secrets are
              encrypted at rest and redacted from execution output.
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
