"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Row } from "@tanstack/react-table";
import { Boxes, Loader2, Network, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  archiveSreService,
  type SreServiceListItem,
} from "@/actions/sre-services";
import type { SreOnboardingStatus } from "@/actions/sre-onboarding";
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

type ServiceCatalogProps = {
  initialServices: SreServiceListItem[];
  loadError: string | null;
  setupStatus?: SreOnboardingStatus | null;
  onSetupChanged?: () => void;
  permissions?: { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
};

export function ServiceCatalog({
  initialServices,
  loadError,
  setupStatus = null,
  onSetupChanged,
  permissions = { canCreate: false, canUpdate: false, canArchive: false },
}: ServiceCatalogProps) {
  const router = useRouter();
  const [services, setServices] = useState(initialServices);
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
    setServices((current) => {
      const exists = current.some((service) => service.id === savedService.id);
      if (exists) {
        return current.map((service) =>
          service.id === savedService.id ? savedService : service,
        );
      }
      return [savedService, ...current];
    });
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
    <div className="space-y-4">
      {services.length === 0 ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No services registered"
          description={permissions.canCreate ? "Add a service, then link its monitors and dependencies to give incidents useful context." : "No services have been added to this project yet. Ask a project editor or administrator to add one."}
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
              setupGuide={setupStatus ? <SreSetupGuideDialog status={setupStatus} /> : undefined}
            />
          )}
          entityLabel="services"
          meta={{
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
        onOpenChange={(open) => !open && setArchivingService(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive service?</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingService?.name} will be marked deprecated instead of
              deleted, preserving topology and incident history.
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
