"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { Cable, FileSearch, Loader2, MoreHorizontal, Plus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  disableSreConnector,
  getPrivateAgentConnectorJobResult,
  searchSreConnectorEvidence,
  validateSreConnector,
  type SreConnectorListItem,
  type SreConnectorSearchResult,
  type SrePrivateAgentJobResult,
  type SreConnectorSetupOptions,
} from "@/actions/sre-connectors";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { ConnectorCredentialDialog } from "@/components/sre/connectors/connector-credential-dialog";
import { ConnectorFormDialog } from "@/components/sre/connectors/connector-form-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getConnectorQueryGuide } from "./connector-query-guides";

type ConnectorAdminViewProps = {
  initialConnectors: SreConnectorListItem[];
  setupOptions: SreConnectorSetupOptions;
  loadError: string | null;
};

const statusClasses: Record<SreConnectorListItem["status"], string> = {
  configured: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  valid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  unreachable: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  missing_credentials: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  disabled: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

const jobStatusClasses: Record<NonNullable<SreConnectorListItem["latestPrivateAgentJob"]>["status"], string> = {
  queued: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  leased: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  running: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  cancelled: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
  timed_out: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
};

function formatConnectorType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatJobSummary(job: NonNullable<SreConnectorListItem["latestPrivateAgentJob"]>) {
  if (job.status === "completed") {
    return `${job.evidenceCount} evidence item${job.evidenceCount === 1 ? "" : "s"}${job.truncated ? " (truncated)" : ""}`;
  }

  if (job.errorCode) {
    return job.errorCode;
  }

  return job.completedAt ? `Completed ${job.completedAt.toLocaleString()}` : `Queued ${job.createdAt.toLocaleString()}`;
}

function formatDateTime(value: string | Date | null) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function connectorMatches(connector: SreConnectorListItem, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [connector.name, connector.type, connector.status, connector.privateAgent?.name]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(query));
}

export function ConnectorAdminView({ initialConnectors, setupOptions, loadError }: ConnectorAdminViewProps) {
  const [connectors, setConnectors] = useState(initialConnectors);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [rotatingCredentialConnector, setRotatingCredentialConnector] = useState<SreConnectorListItem | null>(null);
  const [disablingConnector, setDisablingConnector] = useState<SreConnectorListItem | null>(null);
  const [jobResult, setJobResult] = useState<Extract<SrePrivateAgentJobResult, { success: true }>["job"] | null>(null);
  const [searchConnector, setSearchConnector] = useState<SreConnectorListItem | null>(null);
  const [searchServiceId, setSearchServiceId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTimeWindowMinutes, setSearchTimeWindowMinutes] = useState("60");
  const [searchResult, setSearchResult] = useState<Extract<SreConnectorSearchResult, { success: true }> | null>(null);
  const [isDisabling, startDisableTransition] = useTransition();
  const [isValidating, startValidateTransition] = useTransition();
  const [isLoadingJobResult, startJobResultTransition] = useTransition();
  const [isSearchingConnector, startSearchTransition] = useTransition();

  const filteredConnectors = connectors.filter((connector) => {
    const matchesStatus = statusFilter === "all" || connector.status === statusFilter;
    return matchesStatus && connectorMatches(connector, deferredSearch);
  });

  const handleSaved = (savedConnector: SreConnectorListItem) => {
    setConnectors((current) => {
      const exists = current.some((connector) => connector.id === savedConnector.id);
      if (exists) {
        return current.map((connector) => (connector.id === savedConnector.id ? savedConnector : connector));
      }
      return [savedConnector, ...current];
    });
  };

  const confirmDisable = () => {
    if (!disablingConnector) return;

    startDisableTransition(async () => {
      const result = await disableSreConnector({ id: disablingConnector.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.connector) {
        handleSaved(result.connector);
      }

      toast.success(result.message);
      setDisablingConnector(null);
    });
  };

  const validateConnector = (connector: SreConnectorListItem) => {
    startValidateTransition(async () => {
      const result = await validateSreConnector({ id: connector.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.connector) {
        handleSaved(result.connector);
      }

      if (result.connector?.lastValidationStatus === "valid") {
        toast.success(result.message);
      } else {
        toast.warning(result.message);
      }
    });
  };

  const servicesForConnector = (connector: SreConnectorListItem) => {
    if (connector.scopedServiceIds.length === 0) {
      return setupOptions.services;
    }

    return setupOptions.services.filter((service) => connector.scopedServiceIds.includes(service.id));
  };

  const openSearchDialog = (connector: SreConnectorListItem) => {
    const guide = getConnectorQueryGuide(connector.type);
    const availableServices = servicesForConnector(connector);
    setSearchConnector(connector);
    setSearchServiceId(availableServices[0]?.id ?? "");
    setSearchQuery(guide.examples[0]?.query ?? "");
    setSearchTimeWindowMinutes(String(connector.defaultTimeWindowMinutes));
    setSearchResult(null);
  };

  const submitConnectorSearch = () => {
    if (!searchConnector) return;

    startSearchTransition(async () => {
      const result = await searchSreConnectorEvidence({
        id: searchConnector.id,
        serviceId: searchServiceId,
        query: searchQuery,
        timeWindowMinutes: Number(searchTimeWindowMinutes),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setSearchResult(result);
      toast.success(result.message);
    });
  };

  const viewLatestJobResult = (connector: SreConnectorListItem) => {
    if (!connector.latestPrivateAgentJob) return;

    startJobResultTransition(async () => {
      const result = await getPrivateAgentConnectorJobResult({ jobId: connector.latestPrivateAgentJob!.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setJobResult(result.job);
    });
  };

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Connectors unavailable"
        description={loadError}
        icon={<Cable className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 pt-6">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Connectors</h2>
          <p className="text-sm text-muted-foreground">
            Manage read-only operational evidence connectors for SRE investigations
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add connector
        </Button>
      </div>

      {connectors.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No connectors configured"
          description="Add a read-only connector to enrich incident investigations with code, metrics, infrastructure, or log evidence."
          icon={<ShieldCheck className="h-10 w-10" />}
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add connector
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative md:max-w-sm md:flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search connector, type, agent..."
                className="pl-9"
                aria-label="Search connectors"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-56" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="configured">Configured</SelectItem>
                <SelectItem value="valid">Valid</SelectItem>
                <SelectItem value="missing_credentials">Missing credentials</SelectItem>
                <SelectItem value="unreachable">Unreachable</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Execution</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConnectors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                      No connectors match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredConnectors.map((connector) => (
                    <TableRow key={connector.id}>
                      <TableCell className="min-w-[260px] whitespace-normal">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{connector.name}</span>
                            <Badge variant="outline">{formatConnectorType(connector.type)}</Badge>
                            <Badge variant="secondary">{connector.riskLevel}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {connector.hasCredentials ? "Credentials encrypted" : "Credentials not configured"}
                          </p>
                          {connector.endpointUrl && (
                            <p className="max-w-md truncate text-xs text-muted-foreground">{connector.endpointUrl}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="capitalize">{connector.executionMode.replace("_", " ")}</p>
                          {connector.privateAgent && (
                            <p className="text-xs text-muted-foreground">
                              {connector.privateAgent.name} · {connector.privateAgent.status}
                            </p>
                          )}
                          {connector.latestPrivateAgentJob && (
                            <div className="space-y-1 pt-1">
                              <Badge
                                variant="outline"
                                className={cn("capitalize", jobStatusClasses[connector.latestPrivateAgentJob.status])}
                              >
                                Last job {connector.latestPrivateAgentJob.status.replace(/_/g, " ")}
                              </Badge>
                              <p className="max-w-52 truncate text-xs text-muted-foreground">
                                {formatJobSummary(connector.latestPrivateAgentJob)}
                              </p>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {connector.scopedServiceIds.length > 0 ? (
                          <Badge variant="outline">{connector.scopedServiceIds.length} service(s)</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">Org-wide</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("capitalize", statusClasses[connector.status])}>
                          {connector.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          <p>{connector.outputLimits.maxRows} rows</p>
                          <p>{connector.outputLimits.maxSeconds}s timeout</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openSearchDialog(connector)}
                            aria-label={`Search evidence for ${connector.name}`}
                          >
                            <FileSearch className="mr-2 h-4 w-4" />
                            Search
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Open actions for ${connector.name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openSearchDialog(connector)}>
                                Search evidence
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => validateConnector(connector)} disabled={isValidating}>
                                Validate connector
                              </DropdownMenuItem>
                              {connector.latestPrivateAgentJob && (
                                <DropdownMenuItem onClick={() => viewLatestJobResult(connector)} disabled={isLoadingJobResult}>
                                  View last job result
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setRotatingCredentialConnector(connector)} disabled={isDisabling || isValidating}>
                                Rotate credential
                              </DropdownMenuItem>
                              {connector.status !== "disabled" && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDisablingConnector(connector)}
                                >
                                  Disable connector
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {isCreateOpen && (
        <ConnectorFormDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          setupOptions={setupOptions}
          onSaved={handleSaved}
        />
      )}

      {rotatingCredentialConnector && (
        <ConnectorCredentialDialog
          connector={rotatingCredentialConnector}
          open={Boolean(rotatingCredentialConnector)}
          onOpenChange={(open) => !open && setRotatingCredentialConnector(null)}
          onSaved={handleSaved}
        />
      )}

      <Dialog open={Boolean(searchConnector)} onOpenChange={(open) => !open && setSearchConnector(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl min-w-2xl gap-3 overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Search connector evidence</DialogTitle>
            <DialogDescription>
              Run a bounded, read-only connector search for one service. Searches are rate-limited, audited, and redacted before AI use.
            </DialogDescription>
          </DialogHeader>

          {searchConnector && (
            <div className="space-y-4">
              {(() => {
                const guide = getConnectorQueryGuide(searchConnector.type);
                const availableServices = servicesForConnector(searchConnector);

                return (
                  <>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium">{guide.label} query guide</p>
                          <p className="text-xs text-muted-foreground">{guide.setupHint}</p>
                        </div>
                        <Badge variant="outline">{guide.queryLabel}</Badge>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {guide.examples.map((example) => (
                          <button
                            key={example.label}
                            type="button"
                            onClick={() => setSearchQuery(example.query)}
                            className="rounded-md border bg-background p-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block text-xs font-medium">{example.label}</span>
                            <code className="mt-1 block break-words rounded bg-muted px-2 py-1 font-mono text-xs">
                              {example.query}
                            </code>
                            <span className="mt-1 block text-xs text-muted-foreground">{example.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <form
                      className="grid gap-3 md:grid-cols-[1fr_160px]"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitConnectorSearch();
                      }}
                    >
                      <div className="space-y-1.5">
                        <label htmlFor="connector-search-service" className="text-sm font-medium">Service</label>
                        <Select value={searchServiceId || undefined} onValueChange={setSearchServiceId}>
                          <SelectTrigger id="connector-search-service">
                            <SelectValue placeholder="Select service" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableServices.map((service) => (
                              <SelectItem key={service.id} value={service.id}>
                                {service.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="connector-search-window" className="text-sm font-medium">Window</label>
                        <Select value={searchTimeWindowMinutes} onValueChange={setSearchTimeWindowMinutes}>
                          <SelectTrigger id="connector-search-window">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="240">4 hours</SelectItem>
                            <SelectItem value="1440">24 hours</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <label htmlFor="connector-search-query" className="text-sm font-medium">{guide.queryLabel}</label>
                        <Input
                          id="connector-search-query"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder={guide.queryPlaceholder}
                        />
                      </div>
                      {availableServices.length === 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 md:col-span-2">
                          No matching services are available for this connector scope.
                        </div>
                      )}
                      <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-xs text-muted-foreground">
                          Results are capped by the connector limits: {searchConnector.outputLimits.maxRows} rows, {searchConnector.outputLimits.maxSeconds}s timeout.
                        </p>
                        <Button type="submit" disabled={isSearchingConnector || !searchServiceId || !searchQuery.trim()}>
                          {isSearchingConnector && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Search evidence
                        </Button>
                      </div>
                    </form>

                    {searchResult && (
                      <div className="space-y-3 rounded-lg border p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium">{searchResult.message}</p>
                            <p className="text-xs text-muted-foreground">
                              {searchResult.privateAgentJobId ? `Private Agent job ${searchResult.privateAgentJobId}` : `${searchResult.evidence.length} evidence item${searchResult.evidence.length === 1 ? "" : "s"}`}
                              {searchResult.truncated ? " (truncated)" : ""}
                            </p>
                          </div>
                          {searchResult.privateAgentJobId && <Badge variant="secondary">Queued</Badge>}
                        </div>

                        {searchResult.evidence.length > 0 && (
                          <div className="space-y-2">
                            {searchResult.evidence.map((item) => (
                              <div key={item.id} className="rounded-md border bg-muted/20 p-2">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-medium">{item.title}</p>
                                      <Badge variant="outline">{item.evidenceType}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{item.summary}</p>
                                    <p className="truncate text-xs text-muted-foreground">{item.sourceUri}</p>
                                  </div>
                                  <p className="shrink-0 font-mono text-xs text-muted-foreground">{item.resultHash.slice(0, 12)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(jobResult)} onOpenChange={(open) => !open && setJobResult(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl min-w-2xl gap-3 overflow-y-auto p-5">
          <DialogHeader>
            <DialogTitle>Private Agent Job Result</DialogTitle>
            <DialogDescription>
              Sanitized result summary for the latest connector query job. Raw connector payloads and credentials are not shown.
            </DialogDescription>
          </DialogHeader>

          {jobResult && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border p-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant="outline" className={cn("mt-1 capitalize", jobStatusClasses[jobResult.status])}>
                    {jobResult.status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Connector</p>
                  <p className="mt-1 font-medium">{jobResult.connectorName ?? "Unknown connector"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Evidence</p>
                  <p className="mt-1 font-medium">
                    {jobResult.evidence.length} item{jobResult.evidence.length === 1 ? "" : "s"}
                    {jobResult.truncated ? " (truncated)" : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="mt-1">{formatDateTime(jobResult.startedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="mt-1">{formatDateTime(jobResult.completedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="mt-1">{jobResult.durationMs === null ? "Not recorded" : `${jobResult.durationMs}ms`}</p>
                </div>
              </div>

              {jobResult.errorCode && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {jobResult.errorCode}
                </div>
              )}

              {jobResult.evidence.length === 0 ? (
                <DashboardEmptyState
                  className="min-h-[260px]"
                  title="No evidence returned"
                  description="The job has not completed yet or it completed without evidence summaries."
                  icon={<FileSearch className="h-10 w-10" />}
                />
              ) : (
                <div className="space-y-2">
                  {jobResult.evidence.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{item.title}</p>
                            <Badge variant="secondary">{item.evidenceType}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.summary}</p>
                          <p className="truncate text-xs text-muted-foreground">{item.sourceUri}</p>
                        </div>
                        <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                          <p>{formatDateTime(item.observedAt)}</p>
                          <p className="font-mono">{item.resultHash.slice(0, 12)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(disablingConnector)} onOpenChange={(open) => !open && setDisablingConnector(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable connector?</AlertDialogTitle>
            <AlertDialogDescription>
              {disablingConnector?.name} will stop being available to SRE investigations. Existing evidence and audit history are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisabling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirmDisable();
              }}
              disabled={isDisabling}
            >
              {isDisabling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Disable connector
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
