"use client";

import { X, Info, Copy, Check } from "lucide-react";
import { type Table } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/ui/data-table-view-options";
import { DataTableFacetedFilter } from "@/components/ui/data-table-faceted-filter";
import { Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { VariableDialog } from "./variable-dialog";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useSearchParams, useRouter } from "next/navigation";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

interface TableMeta {
  canManage?: boolean;
  canCreateEdit?: boolean;
  canDelete?: boolean;
  onCreateVariable?: () => void;
  projectId?: string;
  onSuccess?: () => void;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;
  const meta = table.options.meta as TableMeta;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Track if we're intentionally closing the dialog (to prevent race conditions)
  const closingRef = useRef(false);

  // Handler that clears URL params when dialog is closed
  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      closingRef.current = true;
      // Clear create and type params from URL when dialog closes
      const params = new URLSearchParams(searchParams.toString());
      params.delete("create");
      params.delete("type");
      const newUrl = params.toString() ? `/variables?${params.toString()}` : "/variables";
      router.replace(newUrl, { scroll: false });
    }
    setDialogOpen(open);
  };

  // Initialize dialog open state from URL params
  const [dialogOpen, setDialogOpen] = useState(
    () => searchParams.get("create") === "true"
  );

  // Track if we've handled the initial URL-based open
  const initialOpenHandled = useRef(false);

  // Compute default type from URL params
  const urlType = searchParams.get("type");
  const defaultIsSecret = urlType === "secret";
  const defaultType = (urlType === "secret" || urlType === "file") ? urlType : undefined;

  // Handle subsequent URL changes (not initial mount)
  useEffect(() => {
    // Skip the initial mount - already handled by useState initializer
    if (!initialOpenHandled.current) {
      initialOpenHandled.current = true;
      return;
    }

    // Skip if we're intentionally closing the dialog
    if (closingRef.current) {
      closingRef.current = false;
      return;
    }

    // For subsequent URL changes, update dialog state
    // Defer to avoid synchronous setState in effect body
    const create = searchParams.get("create");
    if (create === "true" && !dialogOpen) {
      setTimeout(() => setDialogOpen(true), 0);
    }
  }, [searchParams, dialogOpen]);
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

  const typeOptions = [
    {
      label: "Variable",
      value: "variable",
    },
    {
      label: "Secret",
      value: "secret",
    },
    {
      label: "File",
      value: "file",
    },
  ];

  return (
    <div className="flex items-center justify-between mb-4 -mt-2">
      <div className="flex items-center justify-between space-y-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">Variables</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[480px]" side="bottom" align="start">
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
                      <h4 className="text-xs font-medium text-blue-500">getVariable(key, options?)</h4>
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
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <h4 className="text-xs font-medium text-amber-500">getSecret(key, options?)</h4>
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
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <h4 className="text-xs font-medium text-emerald-500">File Helpers</h4>
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
                            <Check className="h-3 w-3 text-green-500" />
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
          </div>
          <p className="text-muted-foreground text-sm">
            Manage configuration values, secrets and file datasets
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Input
          placeholder="Filter by all available fields..."
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(event) => table.setGlobalFilter(event.target.value)}
          className="h-8 w-[150px] lg:w-[250px]"
        />
        {table.getColumn("type") && (
          <DataTableFacetedFilter
            column={table.getColumn("type")}
            title="Type"
            options={typeOptions}
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => table.resetColumnFilters()}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
        <DataTableViewOptions table={table} />
        {meta?.projectId && (
          <>
            <Button
              onClick={() => setDialogOpen(true)}
              disabled={!meta?.canManage && !meta?.canCreateEdit}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Variable
            </Button>
            {(meta?.canManage || meta?.canCreateEdit) && (
              <VariableDialog
                open={dialogOpen}
                onOpenChange={handleDialogOpenChange}
                projectId={meta.projectId}
                onSuccess={() => {
                  meta.onSuccess?.();
                  handleDialogOpenChange(false);
                }}
                defaultIsSecret={defaultIsSecret}
                defaultType={defaultType as "variable" | "secret" | "file" | undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
