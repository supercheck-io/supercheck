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

  // Compute default secret state from URL params
  const defaultIsSecret = searchParams.get("type") === "secret";

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
      value: "false", // Maps to isSecret: false
    },
    {
      label: "Secret",
      value: "true", // Maps to isSecret: true
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
              <PopoverContent className="w-[430px]" side="bottom" align="start">
                <div className="space-y-3">
                  <div>
                    <h3 className="font-medium text-sm">
                      Variables & Secrets Usage
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Access methods in Playground for Playwright and k6
                      scripts.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium">Example Usage</h4>
                      <div className="relative bg-muted p-3 rounded border border-muted-foreground/20">
                        <pre className="font-mono text-xs overflow-auto max-h-40 text-foreground pr-8 leading-relaxed">
                          {`// Variables
const baseUrl = getVariable('BASE_URL');
// Secrets
const apiKey = getSecret('API_KEY').toString();

// In Playwright
await page.goto(getVariable(baseUrl));
await page.fill('#password', apiKey);

// In k6
  http.get(\`\${baseUrl}/protected\`, {
    headers: { Authorization: \`Bearer \${apiKey}\` }
})`}
                        </pre>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2 h-6 w-6 p-0"
                          onClick={() =>
                            handleCopyCode(`// Variables
const baseUrl = getVariable('BASE_URL');

// Secrets
const apiKey = getSecret('API_KEY').toString();

// In Playwright
await page.goto(getVariable(baseUrl));
await page.fill('#password', apiKey);

// In k6
  http.get(\`\${baseUrl}/protected\`, {
    headers: { Authorization: \`Bearer \${apiKey}\` }
}`)
                          }
                        >
                          {copiedCode ===
                            `// Variables
const baseUrl = getVariable('BASE_URL');

// Secrets
const apiKey = getSecret('API_KEY').toString();

// In Playwright
await page.goto(getVariable(baseUrl));
await page.fill('#password', apiKey);

// In k6
  http.get(\`\${baseUrl}/protected\`, {
    headers: { Authorization: \`Bearer \${apiKey}\` }
})` ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      <strong>Tip:</strong> Use variables for config, secrets
                      for sensitive data. These helpers are available wherever
                      your Playground scripts run.
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <p className="text-muted-foreground text-sm">
            Manage configuration values and secrets
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
        {table.getColumn("isSecret") && (
          <DataTableFacetedFilter
            column={table.getColumn("isSecret")}
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
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
