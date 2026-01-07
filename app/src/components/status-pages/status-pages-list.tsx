"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Plus,
  Tally4,
  ExternalLink,
  Settings,
  Trash2,
  Copy,
  MoreVertical,
  Globe,
  CheckCircle2,
  Circle,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { deleteStatusPage } from "@/actions/delete-status-page";
import { CreateStatusPageForm } from "./create-status-page-form";
import { useProjectContext } from "@/hooks/use-project-context";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import {
  canCreateStatusPages,
  canDeleteStatusPages,
} from "@/lib/rbac/client-permissions";
import { getStatusPageUrl, getBaseDomain } from "@/lib/domain-utils";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { useStatusPages } from "@/hooks/use-status-pages";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

/**
 * Status page type for display purposes.
 * Uses Pick-style subset of the full DB schema fields that the component actually needs.
 * This is intentionally loose to accept both full DB types and partial form results.
 */
type StatusPage = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  pageDescription: string | null;
  headline: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  [key: string]: unknown; // Allow extra fields from DB
};

export default function StatusPagesList() {
  // Use React Query hook for status pages data (cached, handles loading/error)
  const { statusPages: rawStatusPages, isLoading, invalidate } = useStatusPages();

  // Track mount state to prevent hydration mismatch
  const isMounted = useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState<StatusPage | null>(null);
  const searchParams = useSearchParams();

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateStatusPages(normalizedRole);
  const canDelete = canDeleteStatusPages(normalizedRole);

  // Transform API response to local StatusPage type
  const statusPages: StatusPage[] = (rawStatusPages || []).map((page) => ({
    ...page,
    createdAt: page.createdAt ? new Date(page.createdAt) : null,
    updatedAt: page.updatedAt ? new Date(page.updatedAt) : null,
  }));

  useEffect(() => {
    const create = searchParams.get("create");
    if (create === "true" && canCreate) {
      setIsCreateDialogOpen(true);
    }
  }, [searchParams, canCreate]);

  /**
   * Handle successful status page creation.
   * Note: We use server actions for mutations (create/delete) while reads use React Query.
   * This is intentional - server actions provide better error handling and revalidation,
   * while React Query provides caching for reads. After mutation, we invalidate the cache.
   */
  const handleCreateSuccess = () => {
    // Invalidate React Query cache to refresh the list
    invalidate();
    setIsCreateDialogOpen(false);
    toast.success("Status page created successfully");
  };

  const handleDeleteClick = (page: StatusPage) => {
    setDeletingPage(page);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingPage) return;

    try {
      const result = await deleteStatusPage(deletingPage.id);

      if (result.success) {
        // Invalidate React Query cache to refresh the list
        invalidate();
        toast.success("Status page deleted successfully");
      } else {
        toast.error("Failed to delete status page", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error deleting status page:", error);
      toast.error("Failed to delete status page", {
        description: "An unexpected error occurred",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingPage(null);
    }
  };

  const handleCopyUrl = async (subdomain: string) => {
    const url = getStatusPageUrl(subdomain);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copied to clipboard");
    } catch (error) {
      console.error("Failed to copy URL:", error);
      toast.error("Failed to copy URL");
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "published":
        return {
          variant: "default" as const,
          className:
            "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
          icon: CheckCircle2,
          label: "Published",
        };
      case "draft":
        return {
          variant: "secondary" as const,
          className:
            "bg-gray-100 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
          icon: Circle,
          label: "Draft",
        };
      case "archived":
        return {
          variant: "outline" as const,
          className:
            "bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400",
          icon: Archive,
          label: "Archived",
        };
      default:
        return {
          variant: "secondary" as const,
          className:
            "bg-gray-100 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400",
          icon: Circle,
          label: status,
        };
    }
  };

  // Show loading state while data is being fetched
  if (!isMounted || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading status pages..." />
      </div>
    );
  }

  return (
    <div className="p-6">
      <CardHeader className="px-0 pt-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-semibold">
              Status Pages
            </CardTitle>
            <CardDescription>
              Create and manage public status pages for your services
            </CardDescription>
          </div>
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          >
            <DialogTrigger asChild>
              <Button disabled={!canCreate} data-testid="create-status-page-button">
                <Plus className="h-4 w-4 mr-2" />
                Create Status Page
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] min-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Status Page</DialogTitle>
                <DialogDescription>
                  Set up a new public status page for your services
                </DialogDescription>
              </DialogHeader>
              <CreateStatusPageForm
                onSuccess={handleCreateSuccess}
                onCancel={() => setIsCreateDialogOpen(false)}
              />
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={isDeleteDialogOpen}
            onOpenChange={setIsDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Status Page</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{deletingPage?.name}
                  &quot;?
                  <br />
                  <br />
                  <strong>Warning:</strong> This will permanently delete the
                  status page, all incidents, components, and subscribers. This
                  action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    setIsDeleteDialogOpen(false);
                    setDeletingPage(null);
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
        </div>
      </CardHeader>

      {statusPages.length === 0 ? (
        <DashboardEmptyState
          title="No status pages yet"
          description="Create your first status page to communicate service status with your users"
          icon={<Tally4 className="h-12 w-12 text-green-500" />}
          action={
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              disabled={!canCreate}
              size="lg"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Status Page
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 mt-6">
          {statusPages.map((page) => {
            const statusConfig = getStatusConfig(page.status);
            const StatusIcon = statusConfig.icon;

            return (
              <Card
                key={page.id}
                className="group hover:shadow-lg transition-all duration-200 hover:border-primary/20"
                data-testid="status-page-card"
              >
                <div className="p-5">
                  {/* Header with Title and Status */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 flex-shrink-0">
                        <Tally4 className="h-5 w-5 text-green-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                          {page.name}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {page.headline ||
                            page.pageDescription ||
                            "No description"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={statusConfig.variant}
                        className={`${statusConfig.className} text-xs px-2 py-0.5`}
                      >
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusConfig.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/status-pages/${page.id}`}
                              className="cursor-pointer"
                            >
                              <Settings className="h-4 w-4 mr-2" />
                              Manage
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={getStatusPageUrl(page.subdomain)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="cursor-pointer"
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Page
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleCopyUrl(page.subdomain)}
                            className="cursor-pointer"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy URL
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteClick(page)}
                            disabled={!canDelete}
                            className="text-red-600 focus:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* URL Section */}
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 mb-3">
                    <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <code className="text-sm text-muted-foreground truncate flex-1 font-mono">
                      {page.subdomain}.{getBaseDomain()}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-background"
                      onClick={() => handleCopyUrl(page.subdomain)}
                      title="Copy URL"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9"
                    >
                      <Link href={`/status-pages/${page.id}`}>
                        <Settings className="h-4 w-4 mr-1.5" />
                        Manage
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9"
                    >
                      <a
                        href={getStatusPageUrl(page.subdomain)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-1.5" />
                        View
                      </a>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
