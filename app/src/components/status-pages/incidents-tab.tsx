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
import { AlertCircle, Plus, Pencil, Trash2, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Component } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getIncidents } from "@/actions/get-incidents";
import { deleteIncident } from "@/actions/delete-incident";
import { IncidentFormDialog } from "./incident-form-dialog";
import { IncidentUpdateDialog } from "./incident-update-dialog";
import { formatDistanceToNow } from "date-fns";

type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled";
type IncidentImpact = "none" | "minor" | "major" | "critical";

type Incident = {
  id: string;
  name: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  body: string | null;
  createdAt: Date | null;
  resolvedAt: Date | null;
  affectedComponentsCount: number;
  affectedComponents: Array<{ id: string; name: string }>;
  latestUpdate: {
    body: string;
    createdAt: Date | null;
  } | null;
};

type Component = {
  id: string;
  name: string;
};

type IncidentsTabProps = {
  statusPageId: string;
  components: Component[];
};

export function IncidentsTab({ statusPageId, components }: IncidentsTabProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [deletingIncident, setDeletingIncident] = useState<Incident | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(3);

  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getIncidents(statusPageId);

      if (result.success) {
        setIncidents(result.incidents as Incident[]);
        setCurrentPage(1);
      } else {
        console.error('Failed to fetch incidents:', result.message);
        toast.error("Failed to load incidents", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error loading incidents:', error);
      toast.error("Failed to load incidents", {
        description: "An unexpected error occurred",
      });
    } finally {
      setLoading(false);
    }
  }, [statusPageId]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  const handleUpdateClick = (incident: Incident) => {
    setSelectedIncident(incident);
    setIsUpdateDialogOpen(true);
  };

  const handleDeleteClick = (incident: Incident) => {
    setDeletingIncident(incident);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingIncident) return;

    try {
      const result = await deleteIncident(deletingIncident.id, statusPageId);

      if (result.success) {
        setIncidents(prev => prev.filter(i => i.id !== deletingIncident.id));
        toast.success("Incident deleted successfully");
      } else {
        toast.error("Failed to delete incident", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error deleting incident:', error);
      toast.error("Failed to delete incident", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingIncident(null);
    }
  };

  const getStatusBadgeColor = (status: IncidentStatus) => {
    switch (status) {
      case 'investigating':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'identified':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'monitoring':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'resolved':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'scheduled':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  const getImpactBadgeColor = (impact: IncidentImpact) => {
    switch (impact) {
      case 'critical':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'major':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'minor':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'none':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  // Pagination calculations
  const totalPages = Math.ceil(incidents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedIncidents = incidents.slice(startIndex, startIndex + itemsPerPage);

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
                    </div>
                    <div className="flex gap-2">
                      <div className="h-5 w-20 bg-muted rounded" />
                      <div className="h-5 w-20 bg-muted rounded" />
                    </div>
                    <div className="space-y-1">
                      <div className="h-3 w-48 bg-muted rounded" />
                      <div className="h-3 w-40 bg-muted rounded" />
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
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold">Incidents</h3>
            <p className="text-xs text-muted-foreground">
              Manage incidents to communicate service disruptions
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} disabled={components.length === 0} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create Incident
          </Button>
        </div>

        {components.length === 0 && (
          <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-xs text-yellow-800 dark:text-yellow-200">
              You need to create components before you can create incidents.
            </p>
          </div>
        )}

        {incidents.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <h4 className="text-base font-semibold mb-1">No incidents reported</h4>
            <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
              {components.length === 0
                ? "Create components first, then create incidents to communicate service disruptions"
                : "Create incidents to communicate service disruptions to your users"}
            </p>
            {components.length > 0 && (
              <Button onClick={() => setIsCreateDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create First Incident
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {paginatedIncidents.map((incident) => (
                <div
                  key={incident.id}
                  className="border rounded-lg p-3 hover:shadow-md transition-all duration-200 hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-8 mb-1">
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <h4 className="font-semibold text-sm truncate">{incident.name}</h4>
                        </div>
                        {incident.affectedComponents && incident.affectedComponents.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {incident.affectedComponents.map((component) => (
                              <Badge key={component.id} variant="secondary" className="text-xs px-2 py-0.5 flex items-center gap-1">
                                <Component className="h-3 w-3" />
                                {component.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge className={`${getStatusBadgeColor(incident.status)} text-xs px-2 py-0.5`}>
                          {incident.status.replace(/_/g, ' ')}
                        </Badge>
                        <Badge className={`${getImpactBadgeColor(incident.impact)} text-xs px-2 py-0.5`}>
                          {incident.impact}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {incident.latestUpdate && (
                          <p className="truncate">{incident.latestUpdate.body}</p>
                        )}
                        <div className="flex items-center gap-3 flex-wrap">
                          {incident.createdAt && (
                            <span>Created {formatDistanceToNow(new Date(incident.createdAt), { addSuffix: true })}</span>
                          )}
                          {incident.resolvedAt && (
                            <span className="text-green-600 dark:text-green-400">Resolved {formatDistanceToNow(new Date(incident.resolvedAt), { addSuffix: true })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUpdateClick(incident)}
                        className="h-8 w-8 p-0"
                        title="Edit incident"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(incident)}
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Delete incident"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {incidents.length > 0 && (
              <div className="flex items-center justify-between mt-4 px-2">
                <div className="flex-1 text-sm text-muted-foreground">
                  Total {incidents.length} incidents
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

      <IncidentFormDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        statusPageId={statusPageId}
        components={components}
        onSuccess={loadIncidents}
      />

      <IncidentUpdateDialog
        open={isUpdateDialogOpen}
        onOpenChange={setIsUpdateDialogOpen}
        statusPageId={statusPageId}
        incident={selectedIncident}
        onSuccess={loadIncidents}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingIncident?.name}&quot;?
              <br />
              <br />
              This will permanently delete the incident and all its updates. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteDialogOpen(false);
              setDeletingIncident(null);
            }}>
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
    </Card>
  );
}
