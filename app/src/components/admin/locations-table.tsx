"use client";

import * as React from "react";
import {
  useAdminLocations,
  useUpdateLocation,
  useDeleteLocation,
} from "@/hooks/use-locations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableBadge } from "@/components/ui/table-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MapPin,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { AddLocationDialog } from "@/components/admin/add-location-dialog";
import { EditLocationDialog } from "@/components/admin/edit-location-dialog";
import type { LocationWithStatus } from "@/app/api/admin/locations/route";
import { TabLoadingSpinner } from "@/components/ui/table-skeleton";
import { ListPagination } from "@/components/admin/list-pagination";
import { repaginate, useFitPageSize } from "@/hooks/use-fit-page-size";

export function LocationsTable() {
  const { locations, unregisteredLocations, isLoading, refetch } =
    useAdminLocations();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const [addOpen, setAddOpen] = React.useState(false);
  const [editLocation, setEditLocation] =
    React.useState<LocationWithStatus | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<LocationWithStatus | null>(null);

  const handleToggleEnabled = React.useCallback(
    async (loc: LocationWithStatus) => {
      try {
        await updateLocation.mutateAsync({
          id: loc.id,
          isEnabled: !loc.isEnabled,
        });
        toast.success(
          `Location "${loc.name}" ${loc.isEnabled ? "disabled" : "enabled"}`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update location"
        );
      }
    },
    [updateLocation]
  );

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteLocation.mutateAsync(deleteTarget.id);
      toast.success(`Location "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete location"
      );
    }
  }, [deleteTarget, deleteLocation]);

  const { bodyRef, pageSize, setPageSize } = useFitPageSize();
  const [page, setPage] = React.useState({ index: 0, size: pageSize });
  // Auto-fit changes the size outside the table, so carry the page across here.
  if (page.size !== pageSize) {
    setPage({
      index: repaginate(page.index, page.size, pageSize, locations.length),
      size: pageSize,
    });
  }
  const pageCount = Math.max(1, Math.ceil(locations.length / pageSize));
  const pageIndex = Math.min(page.index, pageCount - 1);
  const pageLocations = locations.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize,
  );

  if (isLoading && locations.length === 0) {
    return <TabLoadingSpinner message="Loading locations..." />;
  }

  return (
    <div className="space-y-4">
      {/* Unregistered workers alert */}
      {unregisteredLocations.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Unregistered worker locations detected
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Workers are running with location codes that don&apos;t match any
              registered location:{" "}
              <span className="font-mono">
                {unregisteredLocations.join(", ")}
              </span>
              . Create matching locations to route jobs to these workers.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Location
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-t-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Flag</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-center">Workers</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Default</TableHead>
              <TableHead className="text-center">Enabled</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody ref={bodyRef}>
            {locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center">
                  <p className="text-sm text-muted-foreground">
                    No locations configured. Add your first location to get
                    started.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              pageLocations.map((loc) => (
                <TableRow key={loc.id}>
                  <TableCell className="py-2.5 text-lg">
                    {loc.flag || (
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 font-medium">{loc.name}</TableCell>
                  <TableCell className="py-2.5">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {loc.code}
                    </code>
                  </TableCell>
                  <TableCell className="py-2.5 text-sm text-muted-foreground">
                    {loc.region || "—"}
                  </TableCell>
                  <TableCell className="py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm">{loc.workerCount}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 text-center">
                    <StatusBadge status={loc.status} />
                  </TableCell>
                  <TableCell className="py-2.5 text-center">
                    {loc.isDefault && (
                      <TableBadge tone="purple" compact>
                        Default
                      </TableBadge>
                    )}
                    {!loc.supportsBrowser && (
                      <TableBadge tone="neutral" compact>
                        No browser
                      </TableBadge>
                    )}
                    {!loc.supportsK6 && (
                      <TableBadge tone="neutral" compact>
                        No k6
                      </TableBadge>
                    )}
                  </TableCell>
                  <TableCell className="py-2.5 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex" tabIndex={loc.isDefault || loc.code === "local" ? 0 : undefined}>
                          <Switch
                            aria-label={`Enable ${loc.name}`}
                            checked={loc.isEnabled}
                            onCheckedChange={() => handleToggleEnabled(loc)}
                            disabled={updateLocation.isPending || loc.code === "local" || loc.isDefault}
                          />
                        </span>
                      </TooltipTrigger>
                      {(loc.code === "local" || loc.isDefault) && (
                        <TooltipContent>
                          {loc.code === "local"
                            ? "The local location cannot be disabled. It is the system fallback."
                            : "Choose another default location or clear Default in Edit before disabling this location."}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setEditLocation(loc)}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                        {loc.code !== "local" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(loc)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </>
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
      <ListPagination
        total={locations.length}
        itemName="locations"
        pageIndex={pageIndex}
        pageSize={pageSize}
        pageCount={pageCount}
        onPageChange={(index) => setPage({ index, size: pageSize })}
        onPageSizeChange={setPageSize}
      />

      {/* Add dialog */}
      <AddLocationDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* Edit dialog */}
      {editLocation && (
        <EditLocationDialog
          location={editLocation}
          open={!!editLocation}
          onOpenChange={(open: boolean) => {
            if (!open) setEditLocation(null);
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.name}</strong> (
              <code>{deleteTarget?.code}</code>)?
              {deleteTarget?.workerCount && deleteTarget.workerCount > 0 ? (
                <span className="mt-2 block text-amber-600 dark:text-amber-400">
                  This location has {deleteTarget.workerCount} active
                  worker(s). Jobs in its queue will be drained before deletion.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLocation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "offline" | "disabled" }) {
  switch (status) {
    case "active":
      return (
        <TableBadge tone="success" compact>
          Active
        </TableBadge>
      );
    case "offline":
      return (
        <TableBadge tone="warning" compact>
          Offline
        </TableBadge>
      );
    case "disabled":
      return (
        <TableBadge tone="slate" compact>
          Disabled
        </TableBadge>
      );
  }
}
