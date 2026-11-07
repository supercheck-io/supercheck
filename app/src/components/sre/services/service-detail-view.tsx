"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Boxes,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Gauge,
  GitCommitHorizontal,
  Globe,
  HeartPulse,
  Lightbulb,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Siren,
  Trash2,
  X,
  type LucideIcon,
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
import {
  COLUMN_SCROLL,
  IconTile,
  Metric,
  PANEL_CARD,
  PANEL_CONTENT,
  PANEL_HEADER,
  SectionTitle,
  TAB_TRIGGER,
  type IconTone,
} from "@/components/sre/incidents/incident-ui";
import { PANEL_LINK, SEVERITY_TONES } from "@/components/sre/incidents/incident-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { environmentTone, TIER_HINT, TIER_TONES } from "@/components/sre/services/service-style";
import { cn } from "@/lib/utils";
import { useProjectContext } from "@/hooks/use-project-context";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import {
  getSreServiceDetailQueryKey,
} from "@/lib/sre/query-keys";

type ServiceDetailViewProps = {
  initialDetail: SreServiceDetail;
};

type Health = SreServiceDetail["health"]["health"];

const healthTones: Record<Health, TableBadgeTone> = {
  healthy: "success",
  degraded: "warning",
  failing: "danger",
  unknown: "slate",
};

// The health card's icon tile follows the badge colour.
const healthIconTones: Record<Health, IconTone> = {
  healthy: "emerald",
  degraded: "amber",
  failing: "rose",
  unknown: "slate",
};

type ResourceType = SreServiceDetail["resources"][number]["resourceType"];

const resourceLabels: Record<ResourceType, string> = {
  monitor: "Monitor",
  job: "Job",
  test: "Test",
  status_page_component: "Status component",
  k6_run: "k6 run",
};

const resourceIcons: Record<ResourceType, { icon: LucideIcon; tone: IconTone }> = {
  monitor: { icon: Activity, tone: "emerald" },
  job: { icon: CalendarClock, tone: "blue" },
  test: { icon: FlaskConical, tone: "sky" },
  status_page_component: { icon: Globe, tone: "slate" },
  k6_run: { icon: Gauge, tone: "amber" },
};

const LIST_COLLAPSED = 5;

// Same control as the incident page's Similar incidents list.
function ShowAllToggle({ expanded, total, onToggle }: { expanded: boolean; total: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="mt-2 rounded-sm text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {expanded ? "Show fewer" : `Show all ${total}`}
    </button>
  );
}

// Row actions: same-size icon buttons, each named for its row and labelled on hover.
function RowAction({ label, onClick, disabled, destructive, children }: { label: string; onClick: () => void; disabled?: boolean; destructive?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      {/* The span keeps the tooltip working while the button is disabled. */}
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-8", destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive")}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
const ROW_LIST = "-mx-4 divide-y border-t";

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
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllDeployments, setShowAllDeployments] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(
    null,
  );
  const [resourceType, setResourceType] =
    useState<SreServiceDetail["resources"][number]["resourceType"]>("monitor");
  const [resourceId, setResourceId] = useState("");
  const [relationship, setRelationship] =
    useState<SreServiceDetail["resources"][number]["relationship"]>("monitors");
  const [isPending, startTransition] = useTransition();
  // Its own pending flag, so a mutation does not spin the Refresh button (it still disables it).
  const [refreshing, startRefresh] = useTransition();

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

  const health = detail.health.health;
  const hasLiveSignals = detail.health.activeIncidentCount > 0 || detail.health.firingAlertCount > 0;
  const alerts = showAllAlerts ? detail.recentAlerts : detail.recentAlerts.slice(0, LIST_COLLAPSED);
  const deployments = showAllDeployments ? detail.recentDeployments : detail.recentDeployments.slice(0, LIST_COLLAPSED);
  const repoHref =
    detail.service.repoUrl && /^https?:\/\//i.test(detail.service.repoUrl)
      ? detail.service.repoUrl
      : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <header className="flex shrink-0 flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button asChild variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0">
            <Link href="/services">
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Back to services</span>
            </Link>
          </Button>
          <div className="min-w-0">
            {/* Pills sit beside the name, like the incident header's status and severity. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 break-words text-xl font-semibold leading-tight sm:text-2xl">
                {detail.service.name}
              </h1>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <TableBadge tone={TIER_TONES[detail.service.tier]} compact>
                        Tier {detail.service.tier}
                      </TableBadge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{TIER_HINT[detail.service.tier]}</TooltipContent>
                </Tooltip>
                {detail.service.environment && (
                  <TableBadge tone={environmentTone(detail.service.environment)} compact>
                    {detail.service.environment}
                  </TableBadge>
                )}
                {detail.service.status !== "active" && (
                  <TableBadge tone="warning" compact className="capitalize">
                    {detail.service.status}
                  </TableBadge>
                )}
              </div>
            </div>
            {detail.service.description && (
              <p className="mt-1 max-w-3xl break-words text-sm text-muted-foreground">
                {detail.service.description}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 self-start"
          onClick={() =>
            startRefresh(async () => {
              await refresh();
            })
          }
          disabled={refreshing || isPending}
          aria-label="Refresh service details"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {/* Tabs sit above both columns so the first card on each side starts on the same line. */}
      <Tabs defaultValue="context" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        <TabsList className="h-auto w-full shrink-0 flex-wrap justify-start self-start sm:w-auto">
          <TabsTrigger value="context" className={TAB_TRIGGER}>
            <Activity aria-hidden="true" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="resources" className={TAB_TRIGGER}>
            <Boxes aria-hidden="true" />
            Resources
          </TabsTrigger>
          <TabsTrigger value="dependencies" className={TAB_TRIGGER}>
            <Network aria-hidden="true" />
            Dependencies
            {pendingSuggestions.length > 0 && (
              <TableBadge tone="warning" compact>
                {pendingSuggestions.length}
              </TableBadge>
            )}
          </TabsTrigger>
        </TabsList>

        <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
          <div className={cn("flex min-w-0 flex-col", COLUMN_SCROLL)}>
        <TabsContent
          value="dependencies"
          className="mt-0 space-y-4"
        >
          <Card className={PANEL_CARD}>
            <CardHeader className={PANEL_HEADER}>
              <SectionTitle
                as="h2"
                icon={Network}
                tone="blue"
                count={activeDependencies.length}
                action={
                  detail.permissions.canEdit && (
                    <Button size="sm" onClick={openNewDependency}>
                      <Plus className="h-4 w-4" /> Add dependency
                    </Button>
                  )
                }
                hint="Services this one calls, and services that call it. Copilot and investigations follow these links to check upstream and downstream health."
              >
                Dependencies
              </SectionTitle>
            </CardHeader>
            <CardContent className={PANEL_CONTENT}>
              {activeDependencies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No dependencies yet.
                </p>
              ) : (
                <div className={ROW_LIST}>
                  {activeDependencies.map((dependency) => {
                    const outbound =
                      dependency.sourceServiceId === detail.service.id;
                    return (
                      <div
                        key={dependency.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <IconTile
                            icon={outbound ? ArrowUpRight : ArrowDownLeft}
                            tone={outbound ? "blue" : "slate"}
                            className="mt-0.5"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {outbound
                                ? dependency.targetServiceName
                                : dependency.sourceServiceName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {outbound
                                ? "This service depends on it"
                                : "It depends on this service"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <TableBadge
                            tone={dependency.source === "manual" ? "info" : dependency.source === "ai_suggested" ? "purple" : "slate"}
                            compact
                            className="capitalize"
                          >
                            {dependency.source.replaceAll("_", " ")}
                          </TableBadge>
                          {dependency.confidence !== null && (
                            <span className="px-1 text-xs tabular-nums text-muted-foreground">
                              {Math.round(dependency.confidence * 100)}%
                            </span>
                          )}
                          {detail.permissions.canEdit && (
                            <>
                              <RowAction
                                label={`Edit dependency with ${outbound ? dependency.targetServiceName : dependency.sourceServiceName}`}
                                onClick={() => openEditDependency(dependency)}
                              >
                                <Pencil className="h-4 w-4" />
                              </RowAction>
                              <RowAction
                                label={`Remove dependency with ${outbound ? dependency.targetServiceName : dependency.sourceServiceName}`}
                                destructive
                                disabled={isPending}
                                onClick={() =>
                                  runMutation(() =>
                                    removeSreServiceDependency({
                                      id: dependency.id,
                                    }),
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </RowAction>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          {detail.suggestions.length > 0 && (
            <Collapsible className="rounded-xl border p-4">
              <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-sm text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                <IconTile icon={Lightbulb} tone="amber" />
                Suggested dependencies
                {pendingSuggestions.length > 0
                  ? ` (${pendingSuggestions.length} pending)`
                  : ""}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="my-3 text-sm text-muted-foreground">
                  Review discovered relationships before adding them to the map.
                </p>
                <div className="divide-y overflow-hidden rounded-md border">
                  {detail.suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {suggestion.sourceServiceName} →{" "}
                          {suggestion.targetServiceName}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-muted-foreground">
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
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              runMutation(() =>
                                rejectSreTopologySuggestion({
                                  id: suggestion.id,
                                }),
                              )
                            }
                          >
                            <X className="h-4 w-4" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              runMutation(() =>
                                approveSreTopologySuggestion({
                                  id: suggestion.id,
                                }),
                              )
                            }
                          >
                            <Check className="h-4 w-4" /> Approve
                          </Button>
                        </div>
                      ) : suggestion.status === "pending" ? (
                        <TableBadge tone="slate" compact>
                          Configure access required
                        </TableBadge>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </TabsContent>

        <TabsContent
          value="resources"
          className="mt-0 space-y-4"
        >
          <Card className={PANEL_CARD}>
            <CardHeader className={PANEL_HEADER}>
              <SectionTitle
                as="h2"
                icon={Boxes}
                tone="sky"
                count={detail.resources.length}
                action={
                  detail.permissions.canEdit && (
                    <Button
                      size="sm"
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
                  )
                }
                hint="Monitors, tests, jobs, status components and k6 runs that belong to this service. Their failures and alerts count toward its health."
              >
                Linked resources
              </SectionTitle>
            </CardHeader>
            <CardContent className={PANEL_CONTENT}>
              {detail.resources.length === 0 ? (
                <EmptySection
                  icon={<Boxes className="h-8 w-8" />}
                  title="No linked resources"
                  description="Link resources to connect their health and alerts to this service."
                />
              ) : (
                <div className={ROW_LIST}>
                  {detail.resources.map((resource) => (
                    <div
                      key={resource.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <IconTile
                          icon={resourceIcons[resource.resourceType].icon}
                          tone={resourceIcons[resource.resourceType].tone}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {resource.resourceName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {resourceLabels[resource.resourceType]}
                            {" · "}
                            <span className="capitalize">
                              {resource.relationship.replaceAll("_", " ")}
                            </span>
                          </p>
                        </div>
                      </div>
                      {detail.permissions.canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <RowAction
                            label={`Edit link for ${resource.resourceName}`}
                            onClick={() => {
                              setEditingResourceId(resource.id);
                              setResourceType(resource.resourceType);
                              setResourceId(resource.resourceId);
                              setRelationship(resource.relationship);
                              setResourceOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </RowAction>
                          <RowAction
                            label={`Unlink ${resource.resourceName}`}
                            destructive
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
                            <Trash2 className="h-4 w-4" />
                          </RowAction>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context" className="mt-0">
          <Card className={PANEL_CARD}>
            <CardHeader className={PANEL_HEADER}>
              <SectionTitle
                as="h2"
                icon={Siren}
                tone="rose"
                count={detail.recentIncidents.length}
                hint="The latest incidents whose primary service is this one, open and resolved, newest first."
              >
                Recent incidents
              </SectionTitle>
            </CardHeader>
            <CardContent className={PANEL_CONTENT}>
              {detail.recentIncidents.length === 0 ? (
                <EmptySection
                  icon={<Siren className="h-8 w-8" />}
                  title="No recent incidents"
                  description="Incidents whose primary service is this one appear here."
                />
              ) : (
                <div className={ROW_LIST}>
                  {detail.recentIncidents.map((incident) => {
                    const status = getDisplayStatus(incident.status, incident.acknowledgedAt);
                    return (
                      <Link
                        key={incident.id}
                        href={`/incidents/${incident.id}`}
                        className="group flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
                            <span className="shrink-0 tabular-nums text-muted-foreground">#{incident.incidentNumber}</span>
                            <span className="truncate">{incident.title}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Updated {formatDate(incident.updatedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <TableBadge tone={status.tone} compact>
                            {status.label}
                          </TableBadge>
                          <TableBadge tone={SEVERITY_TONES[incident.severity]} compact className="uppercase">
                            {incident.severity}
                          </TableBadge>
                          <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
          </div>

          <aside aria-label="Service overview" className={cn("flex min-w-0 flex-col gap-4", COLUMN_SCROLL)}>
            <Card role="region" className={PANEL_CARD} aria-labelledby="service-health-heading">
              <CardHeader className={PANEL_HEADER}>
                <SectionTitle
                  id="service-health-heading"
                  as="h2"
                  icon={HeartPulse}
                  tone={healthIconTones[health]}
                  action={
                    <TableBadge tone={detail.health.stale ? "slate" : healthTones[health]} compact className="capitalize">
                      {detail.health.stale ? "Stale" : health}
                    </TableBadge>
                  }
                >
                  Service health
                </SectionTitle>
              </CardHeader>
              <CardContent className={`space-y-3 ${PANEL_CONTENT}`}>
                <p className="text-sm text-muted-foreground">{detail.health.explanation}</p>
                <dl className="grid grid-cols-2 gap-2">
                  <Metric label="Active incidents">
                    <span className={cn(detail.health.activeIncidentCount > 0 && "text-rose-700 dark:text-rose-400")}>
                      {detail.health.activeIncidentCount}
                    </span>
                  </Metric>
                  <Metric label="Firing alerts">
                    <span className={cn(detail.health.firingAlertCount > 0 && "text-amber-700 dark:text-amber-400")}>
                      {detail.health.firingAlertCount}
                    </span>
                  </Metric>
                  <Metric label="Linked resources">{detail.resources.length}</Metric>
                  <Metric label="Dependencies">{activeDependencies.length}</Metric>
                </dl>
                <dl className="space-y-0.5">
                  {detail.service.ownerTeam && <DetailRow label="Owner">{detail.service.ownerTeam}</DetailRow>}
                  {detail.service.otelServiceName && (
                    <DetailRow label="OTel name">
                      <code className="text-xs">{detail.service.otelServiceName}</code>
                    </DetailRow>
                  )}
                  {detail.service.repoUrl && (
                    <DetailRow label="Repository">
                      {repoHref ? (
                        <a href={repoHref} target="_blank" rel="noopener noreferrer" className={PANEL_LINK}>
                          {detail.service.repoUrl.replace(/^https?:\/\//i, "")}
                        </a>
                      ) : (
                        detail.service.repoUrl
                      )}
                    </DetailRow>
                  )}
                  {detail.service.slackChannel && <DetailRow label="Slack">{detail.service.slackChannel}</DetailRow>}
                  {/* With live incidents or alerts the score is a placeholder (0 or 50%), not a measurement. */}
                  {detail.health.score !== null && !hasLiveSignals && (
                    <DetailRow label="Health score">{Math.round(detail.health.score * 100)}%</DetailRow>
                  )}
                  <DetailRow label="Calculated">{formatDate(detail.health.calculatedAt)}</DetailRow>
                  {detail.service.tags.length > 0 && (
                    <DetailRow label="Tags">
                      <span className="flex flex-wrap gap-1">
                        {detail.service.tags.map((tag) => (
                          <TableBadge key={tag} tone="slate" compact className="h-5 px-1.5">{tag}</TableBadge>
                        ))}
                      </span>
                    </DetailRow>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card className={PANEL_CARD}>
              <CardHeader className={PANEL_HEADER}>
                <SectionTitle as="h2" icon={BellRing} tone="amber" count={detail.recentAlerts.length}>
                  Recent alerts
                </SectionTitle>
              </CardHeader>
              <CardContent className={PANEL_CONTENT}>
                {detail.recentAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No alerts are linked to this service.
                  </p>
                ) : (
                  <ul className="-mx-2 space-y-1">
                    {alerts.map((alert) => (
                      <li key={alert.id} className="rounded-md px-2 py-1.5">
                        <p className="line-clamp-2 break-words text-sm font-medium">{alert.title}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <TableBadge
                            tone={alert.status === "firing" ? "danger" : "slate"}
                            compact
                            className="h-5 px-1.5 capitalize"
                          >
                            {alert.status.replaceAll("_", " ")}
                          </TableBadge>
                          <TableBadge tone={SEVERITY_TONES[alert.severity]} compact className="h-5 px-1.5 uppercase">
                            {alert.severity}
                          </TableBadge>
                          <span>{formatDate(alert.firedAt)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {detail.recentAlerts.length > LIST_COLLAPSED && (
                  <ShowAllToggle
                    expanded={showAllAlerts}
                    total={detail.recentAlerts.length}
                    onToggle={() => setShowAllAlerts((value) => !value)}
                  />
                )}
              </CardContent>
            </Card>

            <Card className={PANEL_CARD}>
              <CardHeader className={PANEL_HEADER}>
                <SectionTitle as="h2" icon={GitCommitHorizontal} tone="sky" count={detail.recentDeployments.length}>
                  Recent deployments
                </SectionTitle>
              </CardHeader>
              <CardContent className={PANEL_CONTENT}>
                {detail.recentDeployments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No deployments are recorded for this service. Deployment
                    context comes from linked GitHub or GitLab connectors
                    during investigations.
                  </p>
                ) : (
                  <ul className="-mx-2 space-y-1">
                    {deployments.map((deployment) => (
                      <li key={deployment.id} className="rounded-md px-2 py-1.5">
                        <p className="line-clamp-2 break-words text-sm font-medium">
                          {deployment.commitMessage ||
                            deployment.commitSha ||
                            `${deployment.source} deployment`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="capitalize">{deployment.source}</span> ·{" "}
                          {formatDate(deployment.deployedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {detail.recentDeployments.length > LIST_COLLAPSED && (
                  <ShowAllToggle
                    expanded={showAllDeployments}
                    total={detail.recentDeployments.length}
                    onToggle={() => setShowAllDeployments((value) => !value)}
                  />
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </Tabs>

      <Dialog open={dependencyOpen} onOpenChange={setDependencyOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] w-[min(94vw,44rem)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDependency ? "Edit dependency" : "Add dependency"}
            </DialogTitle>
            <DialogDescription>
              Choose which service depends on the other.
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
        <DialogContent className="max-h-[calc(100svh-2rem)] w-[min(94vw,48rem)] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingResourceId ? "Edit resource link" : "Link resource"}
            </DialogTitle>
            <DialogDescription>
              Choose a resource from this project to connect its health and
              alerts.
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
