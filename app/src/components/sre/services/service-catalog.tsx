"use client";

import { useDeferredValue, useState, useTransition } from "react";
import {
  Archive,
  Boxes,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { archiveSreService, type SreServiceListItem } from "@/actions/sre-services";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { ServiceFormDialog } from "@/components/sre/services/service-form-dialog";
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

type ServiceCatalogProps = {
  initialServices: SreServiceListItem[];
  loadError: string | null;
};

const tierLabels: Record<SreServiceListItem["tier"], string> = {
  "1": "Tier 1",
  "2": "Tier 2",
  "3": "Tier 3",
  "4": "Tier 4",
};

const statusClasses: Record<SreServiceListItem["status"], string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  deprecated: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  merged: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function serviceMatches(service: SreServiceListItem, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const searchableValues = [
    service.name,
    service.description,
    service.environment,
    service.ownerTeam,
    service.otelServiceName,
    service.slackChannel,
    ...service.tags,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return searchableValues.some((value) => value.toLowerCase().includes(query));
}

export function ServiceCatalog({ initialServices, loadError }: ServiceCatalogProps) {
  const [services, setServices] = useState(initialServices);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [tierFilter, setTierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingService, setEditingService] = useState<SreServiceListItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [archivingService, setArchivingService] = useState<SreServiceListItem | null>(null);
  const [isArchiving, startArchiveTransition] = useTransition();

  const filteredServices = services.filter((service) => {
    const matchesTier = tierFilter === "all" || service.tier === tierFilter;
    const matchesStatus = statusFilter === "all" || service.status === statusFilter;
    return matchesTier && matchesStatus && serviceMatches(service, deferredSearch);
  });

  const handleAdd = () => {
    setEditingService(null);
    setIsFormOpen(true);
  };

  const handleSaved = (savedService: SreServiceListItem) => {
    setServices((current) => {
      const exists = current.some((service) => service.id === savedService.id);
      if (exists) {
        return current.map((service) => (service.id === savedService.id ? savedService : service));
      }
      return [savedService, ...current];
    });
  };

  const confirmArchive = () => {
    if (!archivingService) return;

    startArchiveTransition(async () => {
      const result = await archiveSreService({ id: archivingService.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.service) {
        handleSaved(result.service);
      }
      toast.success(result.message);
      setArchivingService(null);
    });
  };

  if (loadError) {
    return (
      <DashboardEmptyState
        className="min-h-[420px]"
        title="Services unavailable"
        description={loadError}
        icon={<Network className="h-10 w-10" />}
      />
    );
  }

  return (
    <div className="space-y-4 pt-6">
      <div className="mb-4 -mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <h2 className="text-2xl font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">
            Manage services, ownership, telemetry names, and incident routing metadata
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add service
        </Button>
      </div>

      {services.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No services registered"
          description="Add your first production service so incidents, alerts, runbooks, and evidence have a stable system of record."
          icon={<Boxes className="h-10 w-10" />}
          action={
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add service
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
                placeholder="Search service, owner, tag..."
                className="pl-9"
              />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="md:w-44">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                {Object.entries(tierLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="md:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="deprecated">Deprecated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Runtime identity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredServices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                      No services match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredServices.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="min-w-[260px] whitespace-normal">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{service.name}</span>
                            <Badge variant="outline">{tierLabels[service.tier]}</Badge>
                            {service.environment && <Badge variant="secondary">{service.environment}</Badge>}
                          </div>
                          {service.description && (
                            <p className="line-clamp-2 max-w-xl text-xs text-muted-foreground">
                              {service.description}
                            </p>
                          )}
                          {service.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {service.tags.slice(0, 5).map((tag) => (
                                <Badge key={tag} variant="outline" className="text-[11px] font-normal">
                                  {tag}
                                </Badge>
                              ))}
                              {service.tags.length > 5 && (
                                <Badge variant="outline" className="text-[11px] font-normal">
                                  +{service.tags.length - 5}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{service.ownerTeam ?? "Unassigned"}</p>
                          {service.slackChannel && (
                            <p className="text-xs text-muted-foreground">{service.slackChannel}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p>{service.otelServiceName ?? "No OTel name"}</p>
                          {service.repoUrl && (
                            <a
                              href={service.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              Repository
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("capitalize", statusClasses[service.status])}>
                          {service.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(service.updatedAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Open actions for ${service.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingService(service);
                                setIsFormOpen(true);
                              }}
                            >
                              Edit service
                            </DropdownMenuItem>
                            {service.status !== "deprecated" && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setArchivingService(service)}
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                Archive service
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {isFormOpen && (
        <ServiceFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          service={editingService}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog open={Boolean(archivingService)} onOpenChange={(open) => !open && setArchivingService(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive service?</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingService?.name} will be marked deprecated instead of deleted, preserving topology and incident history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive} disabled={isArchiving}>
              {isArchiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
