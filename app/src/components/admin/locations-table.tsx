"use client";

import * as React from "react";
import {
  useAdminLocations,
  useUpdateLocation,
  useDeleteLocation,
} from "@/hooks/use-locations";
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
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { AdminListToolbar } from "@/components/admin/admin-list-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { ColumnDef, Table as TableType } from "@tanstack/react-table";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "offline", label: "Offline" },
  { value: "disabled", label: "Disabled" },
];

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

  const columns = React.useMemo<ColumnDef<LocationWithStatus>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Location" />
        ),
        cell: ({ row }) => (
          <div className="flex h-8 items-center gap-2 font-medium">
            {row.original.flag ? (
              <span className="text-lg leading-none">{row.original.flag}</span>
            ) : (
              <MapPin className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="truncate">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "code",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Code" />
        ),
        cell: ({ row }) => (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {row.original.code}
          </code>
        ),
      },
      {
        accessorKey: "region",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Region" />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.region || "-"}
          </span>
        ),
      },
      {
        accessorKey: "workerCount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Workers" />
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{row.original.workerCount}</span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        id: "capabilities",
        header: "Capabilities",
        cell: ({ row }) => {
          const loc = row.original;
          return (
            <div className="flex items-center gap-1 whitespace-nowrap">
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
            </div>
          );
        },
      },
      {
        accessorKey: "isEnabled",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Enabled" />
        ),
        cell: ({ row }) => {
          const loc = row.original;
          const locked = loc.code === "local" || loc.isDefault;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={locked ? 0 : undefined}>
                  <Switch
                    aria-label={`Enable ${loc.name}`}
                    checked={loc.isEnabled}
                    onCheckedChange={() => handleToggleEnabled(loc)}
                    disabled={updateLocation.isPending || locked}
                  />
                </span>
              </TooltipTrigger>
              {locked && (
                <TooltipContent>
                  {loc.code === "local"
                    ? "The local location cannot be disabled. It is the system fallback."
                    : "Choose another default location or clear Default in Edit before disabling this location."}
                </TooltipContent>
              )}
            </Tooltip>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const loc = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Open actions for ${loc.name}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditLocation(loc)}>
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
          );
        },
      },
    ],
    [handleToggleEnabled, updateLocation.isPending],
  );

  const Toolbar = React.useCallback(
    ({ table }: { table: TableType<LocationWithStatus> }) => (
      <AdminListToolbar
        table={table}
        searchPlaceholder="Search locations..."
        facets={[{ columnId: "status", title: "Status", options: STATUS_OPTIONS }]}
      >
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Location
        </Button>
      </AdminListToolbar>
    ),
    [refetch],
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

      <AdminDataTable
        columns={columns}
        data={locations}
        toolbar={Toolbar}
        itemName="locations"
        emptyTitle="No locations configured"
        emptyDescription="Add your first location to get started."
        meta={{ globalFilterColumns: ["name", "code", "region"] }}
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
