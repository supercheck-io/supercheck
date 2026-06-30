"use client";

import { useState, useTransition } from "react";
import { Boxes, Loader2, Network, Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";

import { DataTable } from "@/components/sre/data-table/data-table";
import { columns } from "@/components/sre/data-table/services/columns";
import { ServicesToolbar } from "@/components/sre/data-table/services/toolbar";

type ServiceCatalogProps = {
  initialServices: SreServiceListItem[];
  loadError: string | null;
};

export function ServiceCatalog({ initialServices, loadError }: ServiceCatalogProps) {
  const [services, setServices] = useState(initialServices);
  const [editingService, setEditingService] = useState<SreServiceListItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [archivingService, setArchivingService] = useState<SreServiceListItem | null>(null);
  const [isArchiving, startArchiveTransition] = useTransition();

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
      {services.length === 0 ? (
        <>
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
        </>
      ) : (
        <DataTable
          columns={columns}
          data={services}
          renderToolbar={(table) => (
            <ServicesToolbar
              table={table}
              onAdd={handleAdd}
            />
          )}
          entityLabel="services"
          meta={{
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
