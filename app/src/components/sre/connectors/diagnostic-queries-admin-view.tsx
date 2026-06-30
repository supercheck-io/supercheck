"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, ShieldCheck, SquareLibrary } from "lucide-react";
import { toast } from "sonner";

import {
  createSreDiagnosticQuery,
  disableSreDiagnosticQuery,
  type SreDiagnosticQueryListItem,
  type SreDiagnosticQuerySetupOptions,
} from "@/actions/sre-diagnostic-queries";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getDiagnosticQueryAdapterRecipes, type DiagnosticQueryAdapterRecipe } from "@/lib/sre/connectors/diagnostic-query-adapters";
import { DataTable } from "@/components/sre/data-table/data-table";
import { columns } from "@/components/sre/data-table/runbooks/columns";
import { RunbooksToolbar } from "@/components/sre/data-table/runbooks/toolbar";

type DiagnosticQueriesAdminViewProps = {
  initialQueries: SreDiagnosticQueryListItem[];
  setupOptions: SreDiagnosticQuerySetupOptions;
  loadError: string | null;
};

const queryTypes = ["sql", "promql", "logql", "traceql", "http_get"] as const;

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${Math.round(value / 1024)} KiB`;
}

function parseJsonObject(value: string, label: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function stringifyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

export function DiagnosticQueriesAdminView({ initialQueries, setupOptions, loadError }: DiagnosticQueriesAdminViewProps) {
  const [queries, setQueries] = useState(initialQueries);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingDisableQuery, setPendingDisableQuery] = useState<SreDiagnosticQueryListItem | null>(null);
  const [isDisabling, startDisableTransition] = useTransition();
  const [form, setForm] = useState({
    connectorId: setupOptions.connectors[0]?.id ?? "",
    name: "",
    queryType: "promql",
    template: "",
    parameterSchema: "{}",
    allowlist: '{\n  "metrics": []\n}',
    maxRows: "100",
    maxBytes: "1048576",
    maxSeconds: "10",
  });

  const selectedConnector = setupOptions.connectors.find((connector) => connector.id === form.connectorId);
  const adapterRecipes = selectedConnector ? getDiagnosticQueryAdapterRecipes(selectedConnector.type) : [];

  const upsertQuery = (query: SreDiagnosticQueryListItem) => {
    setQueries((current) => {
      const exists = current.some((item) => item.id === query.id);
      if (exists) {
        return current.map((item) => (item.id === query.id ? query : item));
      }
      return [query, ...current];
    });
  };

  const createQuery = () => {
    let parameterSchema: Record<string, unknown>;
    let allowlist: Record<string, unknown>;

    try {
      parameterSchema = parseJsonObject(form.parameterSchema, "Parameter schema");
      allowlist = parseJsonObject(form.allowlist, "Allowlist");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    startTransition(async () => {
      const result = await createSreDiagnosticQuery({
        connectorId: form.connectorId,
        name: form.name,
        queryType: form.queryType as "sql" | "promql" | "logql" | "traceql" | "http_get",
        template: form.template,
        parameterSchema,
        allowlist,
        maxRows: Number(form.maxRows),
        maxBytes: Number(form.maxBytes),
        maxSeconds: Number(form.maxSeconds),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.query) {
        upsertQuery(result.query);
      }
      toast.success(result.message);
      setIsCreateOpen(false);
      setForm((current) => ({ ...current, name: "", template: "" }));
    });
  };

  const applyRecipe = (recipe: DiagnosticQueryAdapterRecipe) => {
    setForm((current) => ({
      ...current,
      name: recipe.name,
      queryType: recipe.queryType,
      template: recipe.template,
      parameterSchema: stringifyJson(recipe.parameterSchema),
      allowlist: stringifyJson(recipe.allowlist),
      maxRows: String(recipe.limits.maxRows),
      maxBytes: String(recipe.limits.maxBytes),
      maxSeconds: String(recipe.limits.maxSeconds),
    }));
  };

  const confirmDisableQuery = () => {
    if (!pendingDisableQuery) return;

    const query = pendingDisableQuery;
    startDisableTransition(async () => {
      const result = await disableSreDiagnosticQuery({ id: query.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.query) {
        upsertQuery(result.query);
      }
      toast.success(result.message);
      setPendingDisableQuery(null);
    });
  };

  const onEdit = (query: SreDiagnosticQueryListItem) => {
    // Placeholder for edit functionality
  };

  const onDelete = (query: SreDiagnosticQueryListItem) => {
    setPendingDisableQuery(query);
  };

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Runbooks unavailable"
        description={loadError}
        icon={<SquareLibrary className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 pt-6">
      {setupOptions.connectors.length === 0 ? (
        <>
          <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Runbooks</h2>
              <p className="text-sm text-muted-foreground">Prepare approved read-only recipes responders can reuse during investigations.</p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} disabled>
              <Plus className="mr-2 h-4 w-4" />
              Add runbook
            </Button>
          </div>
          <DashboardEmptyState
            className="min-h-[420px]"
            title="Connectors required"
            description="Create an evidence connector first. Runbooks are scoped to one connector and stay read-only."
            icon={<ShieldCheck className="h-10 w-10" />}
          />
        </>
      ) : queries.length === 0 ? (
        <>
          <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Runbooks</h2>
              <p className="text-sm text-muted-foreground">Prepare approved read-only recipes responders can reuse during investigations.</p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add runbook
            </Button>
          </div>
          <DashboardEmptyState
            className="min-h-[420px]"
            title="No runbooks"
            description="Add a bounded, allowlisted runbook recipe for common incident questions such as 5xx spikes, slow traces, or error logs."
            icon={<SquareLibrary className="h-10 w-10" />}
            action={<Button onClick={() => setIsCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Add runbook</Button>}
          />
        </>
      ) : (
        <DataTable
          columns={columns}
          data={queries}
          renderToolbar={(table) => <RunbooksToolbar table={table} onAdd={() => setIsCreateOpen(true)} />}
          entityLabel="runbooks"
          meta={{ onEdit, onDelete, isDisabling, globalFilterColumns: ["name", "queryType", "connectorName", "connectorType", "status"] }}
        />
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="w-[min(94vw,64rem)] max-w-none gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>Add runbook</DialogTitle>
            <DialogDescription>Save a bounded, read-only recipe for future investigations.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6 py-5">
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="grid gap-2 lg:col-span-6">
              <Label>Connector</Label>
              <Select value={form.connectorId} onValueChange={(value) => setForm((current) => ({ ...current, connectorId: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose connector" /></SelectTrigger>
                <SelectContent>{setupOptions.connectors.map((connector) => <SelectItem key={connector.id} value={connector.id}>{connector.name} ({connector.type})</SelectItem>)}</SelectContent>
              </Select>
              </div>
              <div className="grid gap-2 lg:col-span-6">
                <Label>Name</Label>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="High latency by route" />
              </div>
            </div>
            {adapterRecipes.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Recommended recipes</p>
                  <p className="text-xs text-muted-foreground">Optional starting points for this connector.</p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {adapterRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => applyRecipe(recipe)}
                      className="rounded-md border bg-background p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-xs font-medium">{recipe.name}</span>
                      <Badge variant="outline" className="mt-1">{recipe.queryType}</Badge>
                      <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{recipe.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.queryType} onValueChange={(value) => setForm((current) => ({ ...current, queryType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{queryTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Rows</Label>
                <Input type="number" min={1} max={1000} value={form.maxRows} onChange={(event) => setForm((current) => ({ ...current, maxRows: event.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Bytes</Label>
                <Input type="number" min={1024} max={5 * 1024 * 1024} value={form.maxBytes} onChange={(event) => setForm((current) => ({ ...current, maxBytes: event.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label>Seconds</Label>
                <Input type="number" min={1} max={30} value={form.maxSeconds} onChange={(event) => setForm((current) => ({ ...current, maxSeconds: event.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Template</Label>
              <Textarea value={form.template} onChange={(event) => setForm((current) => ({ ...current, template: event.target.value }))} rows={4} placeholder='sum(rate(http_request_duration_seconds_count{service="$service"}[5m])) by (route)' />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Parameter schema JSON</Label>
                <Textarea value={form.parameterSchema} onChange={(event) => setForm((current) => ({ ...current, parameterSchema: event.target.value }))} rows={4} className="font-mono text-xs" />
              </div>
              <div className="grid gap-2">
                <Label>Allowlist JSON</Label>
                <Textarea value={form.allowlist} onChange={(event) => setForm((current) => ({ ...current, allowlist: event.target.value }))} rows={4} className="font-mono text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={createQuery} disabled={isPending || !form.connectorId || !form.name.trim() || !form.template.trim()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save runbook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDisableQuery)} onOpenChange={(open) => { if (!open) setPendingDisableQuery(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable runbook?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {pendingDisableQuery?.name} from investigation tooling. The definition remains stored but will not be available to SRE agents until re-enabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirmDisableQuery();
              }}
              disabled={isDisabling}
            >
              {isDisabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable runbook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
