"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BrainCircuit,
  Boxes,
  Check,
  ExternalLink,
  GitCommitHorizontal,
  Link2,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  addSreServiceResource,
  approveSreTopologySuggestion,
  getSreServiceDetail,
  rejectSreTopologySuggestion,
  removeSreServiceDependency,
  removeSreServiceResource,
  saveSreServiceDependency,
  type SreServiceDependencyItem,
  type SreServiceDetail,
} from "@/actions/sre-services";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreEvidenceGraphQueryKey,
  getSreServiceDetailQueryKey,
} from "@/lib/sre/query-keys";

type ServiceDetailViewProps = {
  initialDetail: SreServiceDetail;
};

const healthTones: Record<
  SreServiceDetail["health"]["health"],
  TableBadgeTone
> = {
  healthy: "success",
  degraded: "warning",
  failing: "danger",
  unknown: "slate",
};

const severityTones: Record<"sev1" | "sev2" | "sev3" | "sev4", TableBadgeTone> =
  {
    sev1: "danger",
    sev2: "warning",
    sev3: "warning",
    sev4: "slate",
  };

const resourceLabels: Record<
  SreServiceDetail["resources"][number]["resourceType"],
  string
> = {
  monitor: "Monitor",
  job: "Job",
  test: "Test",
  status_page_component: "Status component",
  k6_run: "k6 run",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function EmptySection({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed bg-muted/10 px-6 py-8 text-center">
      <div className="mb-3 text-muted-foreground">{icon}</div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function ServiceDetailView({ initialDetail }: ServiceDetailViewProps) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [detail, setDetail] = useState(initialDetail);
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [editingDependency, setEditingDependency] =
    useState<SreServiceDependencyItem | null>(null);
  const [direction, setDirection] = useState<"outbound" | "inbound">(
    "outbound",
  );
  const [relatedServiceId, setRelatedServiceId] = useState("");
  const [resourceOpen, setResourceOpen] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(
    null,
  );
  const [resourceType, setResourceType] =
    useState<SreServiceDetail["resources"][number]["resourceType"]>("monitor");
  const [resourceId, setResourceId] = useState("");
  const [relationship, setRelationship] =
    useState<SreServiceDetail["resources"][number]["relationship"]>("monitors");
  const [isPending, startTransition] = useTransition();

  const availableServices = detail.services.filter(
    (service) =>
      service.id !== detail.service.id && service.status === "active",
  );
  const availableResources = useMemo(() => {
    if (editingResourceId) {
      const editingResource = detail.resources.find(
        (resource) => resource.id === editingResourceId,
      );
      if (!editingResource) return [];
      const matches = detail.resourceCandidates.filter(
        (candidate) =>
          candidate.type === editingResource.resourceType &&
          candidate.id === editingResource.resourceId,
      );
      return matches.length > 0
        ? matches
        : [
            {
              id: editingResource.resourceId,
              name: editingResource.resourceName,
              type: editingResource.resourceType,
            },
          ];
    }
    const linkedIds = new Set(
      detail.resources.map(
        (resource) => `${resource.resourceType}:${resource.resourceId}`,
      ),
    );
    return detail.resourceCandidates.filter(
      (candidate) =>
        candidate.type === resourceType &&
        !linkedIds.has(`${candidate.type}:${candidate.id}`),
    );
  }, [
    detail.resourceCandidates,
    detail.resources,
    editingResourceId,
    resourceType,
  ]);
  const activeDependencies = detail.dependencies.filter(
    (dependency) => dependency.status === "active",
  );
  const pendingSuggestions = detail.suggestions.filter(
    (suggestion) => suggestion.status === "pending",
  );

  const refresh = async () => {
    const result = await getSreServiceDetail({ id: detail.service.id });
    if (!result.success) {
      toast.error(result.error);
      return false;
    }
    setDetail(result.detail);
    queryClient.setQueryData(
      getSreServiceDetailQueryKey(projectId, detail.service.id),
      result,
    );
    await queryClient.invalidateQueries({
      queryKey: getSreEvidenceGraphQueryKey(projectId),
    });
    return true;
  };

  const runMutation = (
    operation: () => Promise<{
      success: boolean;
      error?: string;
      message?: string;
    }>,
    onSuccess?: () => void,
  ) => {
    startTransition(async () => {
      const result = await operation();
      if (!result.success) {
        toast.error(result.error ?? "Action failed");
        return;
      }
      await refresh();
      onSuccess?.();
      toast.success(result.message ?? "Updated");
    });
  };

  const openNewDependency = () => {
    setEditingDependency(null);
    setDirection("outbound");
    setRelatedServiceId("");
    setDependencyOpen(true);
  };

  const openEditDependency = (dependency: SreServiceDependencyItem) => {
    setEditingDependency(dependency);
    const outbound = dependency.sourceServiceId === detail.service.id;
    setDirection(outbound ? "outbound" : "inbound");
    setRelatedServiceId(
      outbound ? dependency.targetServiceId : dependency.sourceServiceId,
    );
    setDependencyOpen(true);
  };

  const saveDependency = () => {
    if (!relatedServiceId) return;
    const sourceServiceId =
      direction === "outbound" ? detail.service.id : relatedServiceId;
    const targetServiceId =
      direction === "outbound" ? relatedServiceId : detail.service.id;
    runMutation(
      () =>
        saveSreServiceDependency({
          id: editingDependency?.id,
          sourceServiceId,
          targetServiceId,
        }),
      () => setDependencyOpen(false),
    );
  };

  const addResource = () => {
    if (!resourceId) return;
    runMutation(
      () =>
        addSreServiceResource({
          serviceId: detail.service.id,
          resourceType,
          resourceId,
          relationship,
        }),
      () => {
        setResourceOpen(false);
        setEditingResourceId(null);
        setResourceId("");
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <header className="flex shrink-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <TableBadge tone="info">Tier {detail.service.tier}</TableBadge>
            <TableBadge
              tone={detail.service.status === "active" ? "success" : "warning"}
              className="capitalize"
            >
              {detail.service.status}
            </TableBadge>
            {detail.service.environment && (
              <TableBadge tone="purple">
                {detail.service.environment}
              </TableBadge>
            )}
          </div>
          <h1 className="break-words text-2xl font-semibold">
            {detail.service.name}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {detail.service.description ||
              "Service topology, ownership, health, and investigation context."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/copilot/evidence-graph?service=${detail.service.id}`}>
              <BrainCircuit className="h-4 w-4" />
              Investigation Map
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              startTransition(async () => {
                await refresh();
              })
            }
            disabled={isPending}
            aria-label="Refresh service details"
          >
            <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      <section
        aria-labelledby="service-health-heading"
        className="grid shrink-0 overflow-hidden rounded-lg border bg-muted/10 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.75fr)_repeat(3,minmax(8rem,0.55fr))]"
      >
        <div className="border-b p-4 sm:col-span-3 xl:col-span-1 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 id="service-health-heading" className="text-sm font-medium">
              Service health
            </h2>
            <TableBadge
              tone={healthTones[detail.health.health]}
              className="capitalize"
            >
              {detail.health.stale ? "Stale" : detail.health.health}
            </TableBadge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {detail.health.explanation}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Calculated {formatDate(detail.health.calculatedAt)}
          </p>
        </div>
        <div className="border-b p-4 sm:border-b-0 sm:border-r">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Score
          </p>
          <p className="mt-1 text-xl font-semibold">
            {detail.health.score === null
              ? "-"
              : `${Math.round(detail.health.score * 100)}%`}
          </p>
        </div>
        <div className="border-b p-4 sm:border-b-0 sm:border-r">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Active incidents
          </p>
          <p className="mt-1 text-xl font-semibold">
            {detail.health.activeIncidentCount}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Firing alerts
          </p>
          <p className="mt-1 text-xl font-semibold">
            {detail.health.firingAlertCount}
          </p>
        </div>
      </section>

      <Tabs
        defaultValue="dependencies"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
      >
        <TabsList className="h-auto shrink-0 justify-start self-start overflow-x-auto">
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="context">Activity</TabsTrigger>
          <TabsTrigger value="suggestions">
            Suggestions
            {pendingSuggestions.length > 0 && (
              <TableBadge tone="warning" compact className="ml-2">
                {pendingSuggestions.length}
              </TableBadge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="dependencies"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-medium">Trusted dependencies</h2>
              <p className="text-sm text-muted-foreground">
                Only active manual, native, observed, or explicitly approved
                edges appear in the Investigation Map.
              </p>
            </div>
            {detail.permissions.canEdit && (
              <Button onClick={openNewDependency}>
                <Plus className="h-4 w-4" /> Add dependency
              </Button>
            )}
          </div>
          {activeDependencies.length === 0 ? (
            <EmptySection
              icon={<Network className="h-8 w-8" />}
              title="No trusted dependencies"
              description="Add a manual dependency or approve a discovery suggestion to establish the service topology."
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-md border">
              {activeDependencies.map((dependency) => {
                const outbound =
                  dependency.sourceServiceId === detail.service.id;
                return (
                  <div
                    key={dependency.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {outbound ? (
                        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                      ) : (
                        <ArrowDownLeft className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {outbound
                            ? dependency.targetServiceName
                            : dependency.sourceServiceName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {outbound
                            ? "This service depends on it"
                            : "It depends on this service"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <TableBadge
                        tone={
                          dependency.source === "manual"
                            ? "info"
                            : dependency.source === "ai_suggested"
                              ? "purple"
                              : "slate"
                        }
                        className="capitalize"
                      >
                        {dependency.source.replaceAll("_", " ")}
                      </TableBadge>
                      {dependency.confidence !== null && (
                        <span className="text-xs text-muted-foreground">
                          {Math.round(dependency.confidence * 100)}%
                        </span>
                      )}
                      {detail.permissions.canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDependency(dependency)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove dependency with ${outbound ? dependency.targetServiceName : dependency.sourceServiceName}`}
                            disabled={isPending}
                            onClick={() =>
                              runMutation(() =>
                                removeSreServiceDependency({
                                  id: dependency.id,
                                }),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="resources"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-medium">Linked resources</h2>
              <p className="text-sm text-muted-foreground">
                Bind native monitors, jobs, tests, status components, and k6
                runs to this service.
              </p>
            </div>
            {detail.permissions.canEdit && (
              <Button
                onClick={() => {
                  setEditingResourceId(null);
                  setResourceType("monitor");
                  setResourceId("");
                  setRelationship("monitors");
                  setResourceOpen(true);
                }}
              >
                <Link2 className="h-4 w-4" /> Link resource
              </Button>
            )}
          </div>
          {detail.resources.length === 0 ? (
            <EmptySection
              icon={<Boxes className="h-8 w-8" />}
              title="No linked resources"
              description="Link native resources to improve health rollups, alert routing, and evidence collection."
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-md border">
              {detail.resources.map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {resource.resourceName}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <TableBadge tone="info" compact>
                        {resourceLabels[resource.resourceType]}
                      </TableBadge>
                      <span className="text-xs text-muted-foreground capitalize">
                        {resource.relationship.replaceAll("_", " ")}
                      </span>
                    </div>
                  </div>
                  {detail.permissions.canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingResourceId(resource.id);
                          setResourceType(resource.resourceType);
                          setResourceId(resource.resourceId);
                          setRelationship(resource.relationship);
                          setResourceOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Unlink ${resource.resourceName}`}
                        disabled={isPending}
                        onClick={() =>
                          runMutation(() =>
                            removeSreServiceResource({
                              id: resource.id,
                              serviceId: detail.service.id,
                            }),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="context"
          className="min-h-0 flex-1 space-y-6 overflow-y-auto"
        >
          <div>
            <h2 className="mb-3 font-medium">Recent incidents</h2>
            {detail.recentIncidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No incidents are linked to this service.
              </p>
            ) : (
              <div className="divide-y overflow-hidden rounded-md border">
                {detail.recentIncidents.map((incident) => (
                  <Link
                    key={incident.id}
                    href={`/incidents/${incident.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        INC-{incident.incidentNumber} · {incident.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Updated {formatDate(incident.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <TableBadge tone={severityTones[incident.severity]}>
                        {incident.severity.toUpperCase()}
                      </TableBadge>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 font-medium">Recent alerts</h2>
              {detail.recentAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No alerts are linked to this service.
                </p>
              ) : (
                <div className="divide-y overflow-hidden rounded-md border">
                  {detail.recentAlerts.slice(0, 8).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {alert.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(alert.firedAt)}
                        </p>
                      </div>
                      <TableBadge tone={severityTones[alert.severity]} compact>
                        {alert.severity.toUpperCase()}
                      </TableBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-3 font-medium">Recent deployments</h2>
              {detail.recentDeployments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No deployments are linked to this service.
                </p>
              ) : (
                <div className="divide-y overflow-hidden rounded-md border">
                  {detail.recentDeployments.slice(0, 8).map((deployment) => (
                    <div
                      key={deployment.id}
                      className="flex items-start gap-3 px-4 py-3"
                    >
                      <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {deployment.commitMessage ||
                            deployment.commitSha ||
                            `${deployment.source} deployment`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {deployment.source} ·{" "}
                          {formatDate(deployment.deployedAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="suggestions"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto"
        >
          <div className="flex items-start gap-3 border-b pb-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="font-medium">Topology trust review</h2>
              <p className="text-sm text-muted-foreground">
                AI and observed relationships stay untrusted until a responder
                with configure access approves them.
              </p>
            </div>
          </div>
          {detail.suggestions.length === 0 ? (
            <EmptySection
              icon={<Check className="h-8 w-8" />}
              title="No pending suggestions"
              description="Newly discovered relationships will appear here for explicit review."
            />
          ) : (
            <div className="divide-y overflow-hidden rounded-md border">
              {detail.suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {suggestion.sourceServiceName} →{" "}
                      {suggestion.targetServiceName}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        Source: {suggestion.source}
                        {suggestion.confidence === null
                          ? ""
                          : ` · ${Math.round(suggestion.confidence * 100)}% confidence`}
                      </p>
                      <TableBadge
                        tone={
                          suggestion.status === "approved"
                            ? "success"
                            : suggestion.status === "rejected"
                              ? "danger"
                              : "warning"
                        }
                        compact
                        className="capitalize"
                      >
                        {suggestion.status}
                      </TableBadge>
                    </div>
                  </div>
                  {suggestion.status === "pending" &&
                  detail.permissions.canConfigure ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runMutation(() =>
                            rejectSreTopologySuggestion({ id: suggestion.id }),
                          )
                        }
                      >
                        <X className="h-4 w-4" /> Reject
                      </Button>
                      <Button
                        disabled={isPending}
                        onClick={() =>
                          runMutation(() =>
                            approveSreTopologySuggestion({ id: suggestion.id }),
                          )
                        }
                      >
                        <Check className="h-4 w-4" /> Approve
                      </Button>
                    </div>
                  ) : suggestion.status === "pending" ? (
                    <TableBadge tone="slate">
                      Configure access required
                    </TableBadge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dependencyOpen} onOpenChange={setDependencyOpen}>
        <DialogContent className="w-[min(94vw,44rem)] max-w-none">
          <DialogHeader>
            <DialogTitle>
              {editingDependency ? "Edit dependency" : "Add dependency"}
            </DialogTitle>
            <DialogDescription>
              Define a trusted directional relationship. Self-links,
              cross-project services, and duplicate active edges are rejected
              server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select
                value={direction}
                onValueChange={(value) =>
                  setDirection(value as typeof direction)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">
                    This service depends on
                  </SelectItem>
                  <SelectItem value="inbound">
                    Depends on this service
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Related service</Label>
              <Select
                value={relatedServiceId}
                onValueChange={setRelatedServiceId}
              >
                <SelectTrigger>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDependencyOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveDependency}
              disabled={!relatedServiceId || isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingDependency ? "Save changes" : "Add dependency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resourceOpen} onOpenChange={setResourceOpen}>
        <DialogContent className="w-[min(94vw,48rem)] max-w-none">
          <DialogHeader>
            <DialogTitle>
              {editingResourceId
                ? "Edit resource link"
                : "Link native resource"}
            </DialogTitle>
            <DialogDescription>
              Choose a resource from the current project. Links improve routing
              and health context without copying raw payloads.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Resource type</Label>
              <Select
                value={resourceType}
                disabled={Boolean(editingResourceId)}
                onValueChange={(value) => {
                  setResourceType(value as typeof resourceType);
                  setResourceId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(resourceLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Resource</Label>
              <Select
                value={resourceId}
                disabled={Boolean(editingResourceId)}
                onValueChange={setResourceId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      availableResources.length
                        ? "Select resource"
                        : "No unlinked resources"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableResources.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-3">
              <Label>Relationship</Label>
              <Select
                value={relationship}
                onValueChange={(value) =>
                  setRelationship(value as typeof relationship)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monitors">Monitors service</SelectItem>
                  <SelectItem value="owned">Owned by service</SelectItem>
                  <SelectItem value="depends_on">
                    Service depends on resource
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start gap-2 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Resource identity and tenant ownership are verified again on the
            server before the link is created.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResourceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addResource} disabled={!resourceId || isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingResourceId ? "Save changes" : "Link resource"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
