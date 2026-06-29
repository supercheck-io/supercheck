"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { Database, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { getDiagnosticQueryAdapterRecipes, type DiagnosticQueryAdapterRecipe } from "@/lib/sre/connectors/diagnostic-query-adapters";

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

function queryMatches(query: SreDiagnosticQueryListItem, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;

  return [query.name, query.queryType, query.connectorName, query.connectorType, query.status]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalized));
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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
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

  const filteredQueries = queries.filter((query) => queryMatches(query, deferredSearch));
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

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Diagnostic queries unavailable"
        description={loadError}
        icon={<Database className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 pt-6">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Diagnostic queries</h2>
          <p className="text-sm text-muted-foreground">Prepare approved read-only recipes responders can reuse during investigations.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} disabled={setupOptions.connectors.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Add query
        </Button>
      </div>

      {setupOptions.connectors.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="Connectors required"
          description="Create an evidence connector first. Diagnostic queries are scoped to one connector and stay read-only."
          icon={<ShieldCheck className="h-10 w-10" />}
        />
      ) : queries.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No diagnostic queries"
          description="Add a bounded, allowlisted query recipe for common incident questions such as 5xx spikes, slow traces, or error logs."
          icon={<Database className="h-10 w-10" />}
          action={<Button onClick={() => setIsCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Add query</Button>}
        />
      ) : (
        <div className="space-y-4">
          <div className="relative md:max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search query, connector, type..." className="pl-9" aria-label="Search diagnostic queries" />
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueries.map((query) => (
                  <TableRow key={query.id}>
                    <TableCell className="max-w-[360px]">
                      <div className="space-y-1">
                        <p className="font-medium">{query.name}</p>
                        <p className="line-clamp-2 font-mono text-xs text-muted-foreground">{query.template}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{query.connectorName}</p>
                      <p className="text-xs text-muted-foreground">{query.connectorType}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline">{query.queryType}</Badge></TableCell>
                    <TableCell className="text-sm">{query.maxRows} rows · {formatBytes(query.maxBytes)} · {query.maxSeconds}s</TableCell>
                    <TableCell><Badge variant={query.status === "active" ? "secondary" : "outline"}>{query.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => setPendingDisableQuery(query)} disabled={isDisabling || query.status === "disabled"}>
                        Disable
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add diagnostic query</DialogTitle>
            <DialogDescription>Templates are stored for future read-only execution. They do not run from this screen.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Connector</Label>
              <Select value={form.connectorId} onValueChange={(value) => setForm((current) => ({ ...current, connectorId: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose connector" /></SelectTrigger>
                <SelectContent>{setupOptions.connectors.map((connector) => <SelectItem key={connector.id} value={connector.id}>{connector.name} ({connector.type})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {adapterRecipes.length > 0 && (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Recommended diagnostic adapters</p>
                  <p className="text-xs text-muted-foreground">
                    Start from a connector-specific, read-only recipe. Review the allowlist before saving.
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {adapterRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => applyRecipe(recipe)}
                      className="rounded-md border bg-background p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-xs font-medium">{recipe.name}</span>
                      <Badge variant="outline" className="mt-1">{recipe.queryType}</Badge>
                      <span className="mt-1 block text-xs text-muted-foreground">{recipe.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="High latency by route" />
            </div>
            <div className="grid gap-2 md:grid-cols-4">
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
              <Textarea value={form.template} onChange={(event) => setForm((current) => ({ ...current, template: event.target.value }))} rows={5} placeholder='sum(rate(http_request_duration_seconds_count{service="$service"}[5m])) by (route)' />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Parameter schema JSON</Label>
                <Textarea value={form.parameterSchema} onChange={(event) => setForm((current) => ({ ...current, parameterSchema: event.target.value }))} rows={6} className="font-mono text-xs" />
              </div>
              <div className="grid gap-2">
                <Label>Allowlist JSON</Label>
                <Textarea value={form.allowlist} onChange={(event) => setForm((current) => ({ ...current, allowlist: event.target.value }))} rows={6} className="font-mono text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={createQuery} disabled={isPending || !form.connectorId || !form.name.trim() || !form.template.trim()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDisableQuery)} onOpenChange={(open) => { if (!open) setPendingDisableQuery(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable diagnostic query?</AlertDialogTitle>
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
              Disable query
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
