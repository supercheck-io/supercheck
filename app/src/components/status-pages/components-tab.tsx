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
  Component,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
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
  const [itemsPerPage, setItemsPerPage] = useState(3);

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

  // Pagination calculations
  const totalPages = Math.ceil(components.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedComponents = components.slice(startIndex, startIndex + itemsPerPage);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 bg-muted rounded" />
                      <div className="h-4 w-32 bg-muted rounded" />
                      <div className="h-5 w-20 bg-muted rounded" />
                    </div>
                    <div className="h-3 w-40 bg-muted rounded" />
                    <div className="flex gap-1">
                      <div className="h-5 w-24 bg-muted rounded" />
                      <div className="h-5 w-24 bg-muted rounded" />
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <div className="h-8 w-8 bg-muted rounded" />
                    <div className="h-8 w-8 bg-muted rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-lg font-semibold">Service Components</h3>
              <p className="text-xs text-muted-foreground">
                Manage the components that make up your service
              </p>
            </div>
            <Button onClick={handleAddComponent} disabled={!canUpdate} size="sm" title={!canUpdate ? "You don't have permission to add components" : ""}>
              <Plus className="h-4 w-4 mr-2" />
              Add Component
            </Button>
          </div>

          {components.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
              <Component className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h4 className="text-base font-semibold mb-1">No components yet</h4>
              <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
                Add components to represent the different parts of your service
              </p>
              <Button onClick={handleAddComponent} disabled={!canUpdate} size="sm" title={!canUpdate ? "You don't have permission to add components" : ""}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Component
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {paginatedComponents.map((component) => (
                  <div
                    key={component.id}
                    className="border rounded-lg p-3 hover:shadow-md transition-all duration-200 hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Component className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <h4 className="font-semibold text-sm truncate">
                            {component.name}
                          </h4>
                          <Badge
                            className={`${getStatusBadgeColor(
                              component.status
                            )} text-xs px-2 py-0.5`}
                          >
                            {getStatusLabel(component.status)}
                          </Badge>
                        </div>
                        {component.description && (
                          <p className="text-xs text-muted-foreground truncate mb-1">
                            {component.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          {component.monitors &&
                          component.monitors.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              {component.monitors.map((monitor) => (
                                <Badge
                                  key={monitor.id}
                                  variant="outline"
                                  className="text-xs px-1.5 py-0.5 gap-0.5"
                                >
                                  <LinkIcon className="h-2.5 w-2.5" />
                                  <span>{monitor.name}</span>
                                </Badge>
                              ))}
                            </div>
                          ) : component.monitor ? (
                            <Badge
                              variant="outline"
                              className="text-xs px-1.5 py-0.5 gap-0.5"
                            >
                              <LinkIcon className="h-2.5 w-2.5" />
                              <span>{component.monitor.name}</span>
                            </Badge>
                          ) : null}
                          {component.showcase && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                              Visible
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditComponent(component)}
                          className="h-8 w-8 p-0"
                          title="Edit component"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(component)}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          title="Delete component"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {components.length > 0 && (
                <div className="flex items-center justify-between mt-4 px-2">
                  <div className="flex-1 text-sm text-muted-foreground">
                    Total {components.length} components
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
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                      >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
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
