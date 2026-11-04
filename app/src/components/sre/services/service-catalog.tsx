"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Row } from "@tanstack/react-table";
import { Boxes, Loader2, Network, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  archiveSreService,
  type SreServiceListItem,
} from "@/actions/sre-services";
import type { SreOnboardingStatus } from "@/actions/sre-onboarding";
import { PageHeader } from "@/components/shared/page-header";
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
import { Button } from "@/components/ui/button";

import { DataTable } from "@/components/sre/data-table/data-table";
import { columns } from "@/components/sre/data-table/services/columns";
import { ServicesToolbar } from "@/components/sre/data-table/services/toolbar";
import { SreSetupGuideDialog } from "@/components/sre/onboarding/sre-setup-guide-dialog";

// Saves the server payload has not caught up with yet. revalidatePath can remount
// the catalog with a payload rendered before the write, so component state alone
// would lose them. Scoped per project and short-lived so nothing leaks across views.
const UNSYNCED_TTL_MS = 60_000;
const unsyncedSaves = new Map<string, { projectId: string; savedAt: number; service: SreServiceListItem }>();

function pendingSaves(projectId: string | undefined) {
  if (!projectId) return [];
  const now = Date.now();
  const pending: SreServiceListItem[] = [];
  for (const [id, entry] of unsyncedSaves) {
    if (now - entry.savedAt > UNSYNCED_TTL_MS) unsyncedSaves.delete(id);
    else if (entry.projectId === projectId) pending.push(entry.service);
  }
  return pending;
}

const isNewer = (a: SreServiceListItem, b: SreServiceListItem) =>
  new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime();

type ServiceCatalogProps = {
  /** Scopes unsynced local saves; omit to disable carrying them across remounts. */
  projectId?: string;
  initialServices: SreServiceListItem[];
  loadError: string | null;
  setupStatus?: SreOnboardingStatus | null;
  onSetupChanged?: () => void;
  permissions?: { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
};

export function ServiceCatalog({
  projectId,
  initialServices,
  loadError,
  setupStatus = null,
  onSetupChanged,
  permissions = { canCreate: false, canUpdate: false, canArchive: false },
}: ServiceCatalogProps) {
  const router = useRouter();
  const [localSaves, setLocalSaves] = useState(() => pendingSaves(projectId));
  const services = useMemo(() => {
    const merged = new Map(initialServices.map((service) => [service.id, service]));
    const added: SreServiceListItem[] = [];
    for (const saved of localSaves) {
      const server = merged.get(saved.id);
      if (!server) added.push(saved);
      else if (isNewer(saved, server)) merged.set(saved.id, saved);
    }
    return [...added, ...merged.values()];
  }, [initialServices, localSaves]);

  // The merge above already prefers a caught-up server row; just stop carrying it across remounts.
  useEffect(() => {
    const server = new Map(initialServices.map((service) => [service.id, service]));
    for (const saved of localSaves) {
      const current = server.get(saved.id);
      if (current && !isNewer(saved, current)) unsyncedSaves.delete(saved.id);
    }
  }, [initialServices, localSaves]);
  const [editingService, setEditingService] =
    useState<SreServiceListItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [archivingService, setArchivingService] =
    useState<SreServiceListItem | null>(null);
  const [isArchiving, startArchiveTransition] = useTransition();

  const handleRowClick = useCallback(
    (row: Row<SreServiceListItem>) => {
      router.push(`/services/${row.original.id}`);
    },
    [router],
  );

  const handleAdd = () => {
    setEditingService(null);
    setIsFormOpen(true);
  };

  const handleSaved = (savedService: SreServiceListItem) => {
    if (projectId) {
      unsyncedSaves.set(savedService.id, { projectId, savedAt: Date.now(), service: savedService });
    }
    setLocalSaves((current) => [
      savedService,
      ...current.filter((service) => service.id !== savedService.id),
    ]);
    onSetupChanged?.();
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
    <div className="mt-6 min-w-0 space-y-4 p-2">
      <PageHeader
        title="Services"
        description="Link monitors and jobs to services for investigation context."
        className="mb-4 -mt-2"
      />
      {services.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No services registered"
          description={
            permissions.canCreate
              ? "Add a service, then link its monitors and dependencies to give incidents useful context."
              : "No services have been added to this project yet. Ask a project editor or administrator to add one."
          }
          icon={<Boxes className="h-10 w-10" />}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              {setupStatus && <SreSetupGuideDialog status={setupStatus} />}
              {permissions.canCreate && (
                <Button onClick={handleAdd} data-testid="add-service-btn">
                  <Plus className="mr-2 h-4 w-4" />
                  Add service
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={services}
          onRowClick={handleRowClick}
          renderToolbar={(table) => (
            <ServicesToolbar
              table={table}
              onAdd={permissions.canCreate ? handleAdd : undefined}
              setupGuide={
                setupStatus ? (
                  <SreSetupGuideDialog status={setupStatus} />
                ) : undefined
              }
            />
          )}
          entityLabel="services"
          meta={{
            globalFilterColumns: [
              "id",
              "name",
              "description",
              "ownerTeam",
              "tags",
              "environment",
              "tier",
              "status",
            ],
            canUpdate: permissions.canUpdate,
            canArchive: permissions.canArchive,
            onEdit: (service: SreServiceListItem) => {
              setEditingService(service);
              setIsFormOpen(true);
            },
            onDelete: (service: SreServiceListItem) => {
              setArchivingService(service);
            },
          }}
        />
      )}

      {isFormOpen && (
        <ServiceFormDialog
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          service={editingService}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog
        open={Boolean(archivingService)}
        // Escape or an outside click must not close it while the archive request is running.
        onOpenChange={(open) => !open && !isArchiving && setArchivingService(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive service?</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingService?.name} will be archived, not deleted. Its
              topology and incident history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Stay open until the request finishes so the spinner and any error are visible.
                event.preventDefault();
                confirmArchive();
              }}
              disabled={isArchiving}
            >
              {isArchiving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Archive service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
