"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  OctagonAlert,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarIcon,
  Loader2,
} from "lucide-react";
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
import { getIncidents } from "@/actions/get-incidents";
import { deleteIncident } from "@/actions/delete-incident";
import { IncidentFormDialog } from "./incident-form-dialog";
import { IncidentUpdateDialog } from "./incident-update-dialog";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "scheduled";
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
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(
    null
  );
  const [deletingIncident, setDeletingIncident] = useState<Incident | null>(
    null
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );

  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getIncidents(statusPageId);

      if (result.success) {
        setIncidents(result.incidents as Incident[]);
        setCurrentPage(1);
      } else {
        console.error("Failed to fetch incidents:", result.message);
        toast.error("Failed to load incidents", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error loading incidents:", error);
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
        setIncidents((prev) =>
          prev.filter((i) => i.id !== deletingIncident.id)
        );
        toast.success("Incident deleted successfully");
      } else {
        toast.error("Failed to delete incident", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error deleting incident:", error);
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
      case "investigating":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "identified":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "monitoring":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "resolved":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "scheduled":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  const getImpactBadgeColor = (impact: IncidentImpact) => {
    switch (impact) {
      case "critical":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "major":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "minor":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "none":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
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

  // Sort incidents
  const sortedIncidents = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return incidents;

    return [...incidents].sort((a, b) => {
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
        case "impact":
          aValue = a.impact;
          bValue = b.impact;
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
  }, [incidents, sortColumn, sortDirection]);

  // Pagination calculations
  const totalPages = Math.ceil(sortedIncidents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedIncidents = sortedIncidents.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  if (loading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <OctagonAlert className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Incidents</CardTitle>
            </div>
            <CardDescription>
              Manage incidents to communicate service disruptions to your users
            </CardDescription>
          </div>
          <Button disabled size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Create Incident
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Incident ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>Affected Components</TableHead>
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
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <OctagonAlert className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Incidents</CardTitle>
          </div>
          <CardDescription>
            Manage incidents to communicate service disruptions to your users
          </CardDescription>
        </div>
        <Button
          onClick={() => setIsCreateDialogOpen(true)}
          disabled={components.length === 0}
          size="sm"
          title={
            components.length === 0 ? "Create components first" : undefined
          }
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Incident
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {components.length === 0 && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
            <OctagonAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              You need to create components before you can create incidents.
            </p>
          </div>
        )}

        {incidents.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed rounded-lg bg-muted/20">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/50 mb-4">
              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
            <h4 className="text-base font-semibold mb-1">
              No incidents reported
            </h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
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
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Incident ID</TableHead>
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
                        {sortColumn === "status" && sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "status" &&
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
                          sortColumn === "impact" && "bg-muted font-semibold"
                        )}
                        onClick={() => handleSort("impact")}
                      >
                        Impact
                        {sortColumn === "impact" && sortDirection === "asc" ? (
                          <ArrowUp className="ml-1 h-4 w-4 text-primary" />
                        ) : sortColumn === "impact" &&
                          sortDirection === "desc" ? (
                          <ArrowDown className="ml-1 h-4 w-4 text-primary" />
                        ) : (
                          <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>Affected Components</TableHead>
                    <TableHead>
                      <button
                        className={cn(
                          "flex items-center gap-1 hover:bg-muted/50 -ml-3 px-3 py-1.5 rounded-md transition-colors",
                          sortColumn === "createdAt" && "bg-muted font-semibold"
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
                  {paginatedIncidents.map((incident) => (
                    <TableRow key={incident.id}>
                      <TableCell>
                        <UUIDField
                          value={incident.id}
                          maxLength={8}
                          onCopy={() =>
                            toast.success("Incident ID copied to clipboard")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <OctagonAlert className="h-4 w-4 text-orange-500 flex-shrink-0" />
                          <TruncatedTextWithTooltip
                            text={incident.name}
                            className="font-medium"
                            maxWidth="180px"
                            maxLength={25}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`${getStatusBadgeColor(incident.status)} capitalize`}
                        >
                          {incident.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`${getImpactBadgeColor(incident.impact)} capitalize`}
                        >
                          {incident.impact}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {incident.affectedComponents &&
                        incident.affectedComponents.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {incident.affectedComponents
                              .slice(0, 2)
                              .map((component) => (
                                <Badge
                                  key={component.id}
                                  variant="outline"
                                  className="text-xs max-w-[120px]"
                                >
                                  <Layers className="h-3 w-3 mr-1 text-blue-600 flex-shrink-0" />
                                  <span className="truncate">
                                    {component.name}
                                  </span>
                                </Badge>
                              ))}
                            {incident.affectedComponents.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{incident.affectedComponents.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            None
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center w-[170px]">
                          <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>
                            {incident.createdAt
                              ? format(
                                  new Date(incident.createdAt),
                                  "MMM d, yyyy"
                                )
                              : "-"}
                          </span>
                          {incident.createdAt && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              {format(new Date(incident.createdAt), "h:mm a")}
                            </span>
                          )}
                        </div>
                        {incident.resolvedAt && (
                          <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                            Resolved{" "}
                            {formatDistanceToNow(
                              new Date(incident.resolvedAt),
                              {
                                addSuffix: true,
                              }
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateClick(incident)}
                            className="h-8 w-8 p-0"
                            title="Edit incident"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(incident)}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            title="Delete incident"
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
            {incidents.length > 0 && (
              <div className="flex items-center justify-between mt-4 px-2">
                <div className="flex-1 text-sm text-muted-foreground">
                  Total {sortedIncidents.length} incidents
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
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
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

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingIncident?.name}
              &quot;?
              <br />
              <br />
              This will permanently delete the incident and all its updates.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setDeletingIncident(null);
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
    </Card>
  );
}
