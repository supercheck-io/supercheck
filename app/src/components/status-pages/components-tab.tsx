"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Plus,
  Pencil,
  Trash2,
  Layers,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarIcon,
  Loader2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { UUIDField } from "@/components/ui/uuid-field";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getComponents } from "@/actions/get-components";
import { deleteComponent } from "@/actions/delete-component";
import { ComponentFormDialog } from "./component-form-dialog";

type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

type Component = {
  id: string;
  statusPageId: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  monitorId: string | null;
  monitorIds: string[];
  showcase: boolean;
  onlyShowIfDegraded: boolean;
  position: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  monitor: {
    id: string;
    name: string;
    type: string;
    status: string;
  } | null;
  monitors: {
    id: string;
    name: string;
    type: string;
    status: string;
  }[];
};

type Monitor = {
  id: string;
  name: string;
  type: string;
};

type ComponentsTabProps = {
  canUpdate: boolean;
  statusPageId: string;
  monitors: Monitor[];
};

export function ComponentsTab({
  canUpdate,
  statusPageId,
  monitors,
}: ComponentsTabProps) {
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<
    Component | undefined
  >();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingComponent, setDeletingComponent] = useState<Component | null>(
    null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );

  const loadComponents = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getComponents(statusPageId);

      if (result.success) {
        setComponents(result.components as Component[]);
        setCurrentPage(1);
      } else {
        console.error("Failed to fetch components:", result.message);
        toast.error("Failed to load components", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error loading components:", error);
      toast.error("Failed to load components", {
        description: "An unexpected error occurred",
      });
    } finally {
      setLoading(false);
    }
  }, [statusPageId]);

  useEffect(() => {
    loadComponents();
  }, [loadComponents]);

  const handleAddComponent = () => {
    setEditingComponent(undefined);
    setIsFormOpen(true);
  };

  const handleEditComponent = (component: Component) => {
    setEditingComponent(component);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (component: Component) => {
    setDeletingComponent(component);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingComponent) return;

    try {
      const result = await deleteComponent(deletingComponent.id, statusPageId);

      if (result.success) {
        setComponents((prev) =>
          prev.filter((c) => c.id !== deletingComponent.id)
        );
        toast.success("Component deleted successfully");
      } else {
        toast.error("Failed to delete component", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error deleting component:", error);
      toast.error("Failed to delete component", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingComponent(null);
    }
  };

  const getStatusBadgeColor = (status: ComponentStatus) => {
    switch (status) {
      case "operational":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "degraded_performance":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "partial_outage":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "major_outage":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "under_maintenance":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  const getStatusLabel = (status: ComponentStatus) => {
    switch (status) {
      case "operational":
        return "Operational";
      case "degraded_performance":
        return "Degraded Performance";
      case "partial_outage":
        return "Partial Outage";
      case "major_outage":
        return "Major Outage";
      case "under_maintenance":
        return "Under Maintenance";
      default:
        return status;
    }
  };

  // Sorting function
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Sort components
  const sortedComponents = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return components;

    return [...components].sort((a, b) => {
      let aValue: string | Date | null = null;
      let bValue: string | Date | null = null;

      switch (sortColumn) {
        case "name":
          aValue = a.name;
          bValue = b.name;
          break;
        case "status":
          aValue = a.status;
          bValue = b.status;
          break;
        case "createdAt":
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        default:
          return 0;
      }

      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return sortDirection === "asc" ? 1 : -1;
      if (bValue === null) return sortDirection === "asc" ? -1 : 1;

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [components, sortColumn, sortDirection]);

  // Pagination calculations
  const totalPages = Math.ceil(sortedComponents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedComponents = sortedComponents.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Service Components</CardTitle>
            </div>
            <CardDescription>
              Manage the components that make up your service. Link monitors to
              automatically track status.
            </CardDescription>
          </div>
          <Button disabled size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Component
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Component ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Linked Monitors</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <div className="flex justify-center items-center space-x-2">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Loading data...
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Service Components</CardTitle>
            </div>
            <CardDescription>
              Manage the components that make up your service. Link monitors to
              automatically track status.
            </CardDescription>
          </div>
          <Button
            onClick={handleAddComponent}
            disabled={!canUpdate}
            size="sm"
            title={
              !canUpdate ? "You don't have permission to add components" : ""
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Component
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {components.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/50 mb-4">
                <Layers className="h-7 w-7 text-blue-600 dark:text-blue-400" />
              </div>
              <h4 className="text-base font-semibold mb-1">
                No components yet
              </h4>
              <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
                Add components to represent the different parts of your service
                and track their status
              </p>
              <Button
                onClick={handleAddComponent}
                disabled={!canUpdate}
                size="sm"
                title={
                  !canUpdate
                    ? "You don't have permission to add components"
                    : ""
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Component
              </Button>
            </div>
          ) : (
            <>
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Component ID</TableHead>
                      <TableHead>
                        <button
                          className={cn(
                            "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                            sortColumn === "name" && "bg-muted font-semibold"
                          )}
                          onClick={() => handleSort("name")}
                        >
                          Name
                          {sortColumn === "name" && sortDirection === "asc" ? (
                            <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                          ) : sortColumn === "name" &&
                            sortDirection === "desc" ? (
                            <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          className={cn(
                            "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                            sortColumn === "status" && "bg-muted font-semibold"
                          )}
                          onClick={() => handleSort("status")}
                        >
                          Status
                          {sortColumn === "status" &&
                          sortDirection === "asc" ? (
                            <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                          ) : sortColumn === "status" &&
                            sortDirection === "desc" ? (
                            <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Linked Monitors</TableHead>
                      <TableHead>
                        <button
                          className={cn(
                            "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                            sortColumn === "createdAt" &&
                              "bg-muted font-semibold"
                          )}
                          onClick={() => handleSort("createdAt")}
                        >
                          Created
                          {sortColumn === "createdAt" &&
                          sortDirection === "asc" ? (
                            <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                          ) : sortColumn === "createdAt" &&
                            sortDirection === "desc" ? (
                            <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedComponents.map((component) => (
                      <TableRow key={component.id}>
                        <TableCell>
                          <UUIDField
                            value={component.id}
                            maxLength={8}
                            onCopy={() =>
                              toast.success("Component ID copied to clipboard")
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 text-blue-600 flex-shrink-0" />
                            <TruncatedTextWithTooltip
                              text={component.name}
                              className="font-medium"
                              maxWidth="140px"
                              maxLength={20}
                            />
                            {component.showcase && (
                              <Badge
                                variant="secondary"
                                className="text-xs flex-shrink-0"
                              >
                                Visible
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`${getStatusBadgeColor(component.status)}`}
                          >
                            {getStatusLabel(component.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {component.description ? (
                            <TruncatedTextWithTooltip
                              text={component.description}
                              className="text-sm text-muted-foreground"
                              maxWidth="200px"
                              maxLength={25}
                            />
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              -
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {component.monitors &&
                          component.monitors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {component.monitors.slice(0, 2).map((monitor) => (
                                <Badge
                                  key={monitor.id}
                                  variant="outline"
                                  className="text-xs max-w-[120px]"
                                >
                                  <LinkIcon className="h-3 w-3 mr-1 flex-shrink-0" />
                                  <span className="truncate">
                                    {monitor.name}
                                  </span>
                                </Badge>
                              ))}
                              {component.monitors.length > 2 && (
                                <Badge variant="outline" className="text-xs">
                                  +{component.monitors.length - 2}
                                </Badge>
                              )}
                            </div>
                          ) : component.monitor ? (
                            <Badge
                              variant="outline"
                              className="text-xs max-w-[120px]"
                            >
                              <LinkIcon className="h-3 w-3 mr-1 flex-shrink-0" />
                              <span className="truncate">
                                {component.monitor.name}
                              </span>
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              No monitors linked
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center w-[170px]">
                            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>
                              {component.createdAt
                                ? format(
                                    new Date(component.createdAt),
                                    "MMM d, yyyy"
                                  )
                                : "-"}
                            </span>
                            {component.createdAt && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                {format(
                                  new Date(component.createdAt),
                                  "h:mm a"
                                )}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditComponent(component)}
                              className="h-8 w-8 p-0"
                              title={
                                !canUpdate
                                  ? "You don't have permission to edit components"
                                  : "Edit component"
                              }
                              disabled={!canUpdate}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(component)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                              title={
                                !canUpdate
                                  ? "You don't have permission to delete components"
                                  : "Delete component"
                              }
                              disabled={!canUpdate}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              {components.length > 0 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <div className="flex-1 text-sm text-muted-foreground">
                    Total {sortedComponents.length} components
                  </div>
                  <div className="flex items-center space-x-6 lg:space-x-8">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm">Rows per page</p>
                      <Select
                        value={`${itemsPerPage}`}
                        onValueChange={(value) => {
                          setItemsPerPage(Number(value));
                          setCurrentPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[70px]">
                          <span>{itemsPerPage}</span>
                        </SelectTrigger>
                        <SelectContent side="top">
                          {[5, 10, 25, 50].map((pageSize) => (
                            <SelectItem key={pageSize} value={`${pageSize}`}>
                              {pageSize}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex w-[100px] items-center justify-center text-sm">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                      >
                        <span className="sr-only">Go to first page</span>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          setCurrentPage((prev) => Math.max(1, prev - 1))
                        }
                        disabled={currentPage === 1}
                      >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          setCurrentPage((prev) =>
                            Math.min(totalPages, prev + 1)
                          )
                        }
                        disabled={currentPage === totalPages}
                      >
                        <span className="sr-only">Go to next page</span>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                      >
                        <span className="sr-only">Go to last page</span>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <ComponentFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        statusPageId={statusPageId}
        component={editingComponent}
        monitors={monitors}
        onSuccess={loadComponents}
      />

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Component</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingComponent?.name}
              &quot;?
              <br />
              <br />
              This will remove the component from your status page and any
              incidents associated with it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setDeletingComponent(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
