"use client";

import React, { useState, useEffect } from "react";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Plus,
  Tally4,
  ExternalLink,
  Settings,
  Trash2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { getStatusPages } from "@/actions/get-status-pages";
import { deleteStatusPage } from "@/actions/delete-status-page";
import { CreateStatusPageForm } from "./create-status-page-form";
import { useProjectContext } from "@/hooks/use-project-context";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import {
  canCreateStatusPages,
  canDeleteStatusPages,
} from "@/lib/rbac/client-permissions";
import { getStatusPageUrl, getBaseDomain } from "@/lib/domain-utils";

type StatusPage = {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  pageDescription: string | null;
  headline: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export default function StatusPagesList() {
  const [statusPages, setStatusPages] = useState<StatusPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState<StatusPage | null>(null);

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateStatusPages(normalizedRole);
  const canDelete = canDeleteStatusPages(normalizedRole);

  useEffect(() => {
    loadStatusPages();
  }, []);

  const loadStatusPages = async () => {
    try {
      setLoading(true);
      const result = await getStatusPages();

      if (result.success) {
        setStatusPages(result.statusPages as StatusPage[]);
      } else {
        console.error("Failed to fetch status pages:", result.message);
        toast.error("Failed to load status pages", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error loading status pages:", error);
      toast.error("Failed to load status pages", {
        description: "An unexpected error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSuccess = (newPage: StatusPage) => {
    setStatusPages((prev) => [newPage, ...prev]);
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
        setStatusPages((prev) => prev.filter((p) => p.id !== deletingPage.id));
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

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "draft":
        return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
      case "archived":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      default:
        return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2"></div>
            <div className="h-4 w-64 bg-muted rounded animate-pulse"></div>
          </div>
          <div className="h-10 w-32 bg-muted rounded animate-pulse"></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2 mb-4"></div>
              <div className="h-8 bg-muted rounded"></div>
            </div>
          ))}
        </div>
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
              <Button disabled={!canCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create Status Page
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
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
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <Tally4 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No status pages yet</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Create your first status page to communicate service status with
            your users
          </p>
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={!canCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Your First Status Page
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-6">
          {statusPages.map((page) => (
            <div
              key={page.id}
              className="border rounded-lg p-4 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">{page.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {page.pageDescription || page.headline || "No description"}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-md whitespace-nowrap ml-2 ${getStatusBadgeColor(
                    page.status
                  )}`}
                >
                  {page.status}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Tally4 className="h-4 w-4 flex-shrink-0 !text-green-600" />
                  <code className="text-xs bg-muted px-2 py-1 rounded truncate flex-1">
                    {page.subdomain}.{getBaseDomain()}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 hover:bg-muted"
                    onClick={() => handleCopyUrl(page.subdomain)}
                    title="Copy URL"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    <Link href={`/status-pages/${page.id}`}>
                      <Settings className="h-4 w-4 mr-1" />
                      Manage
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                  >
                    <a
                      href={getStatusPageUrl(page.subdomain)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(page)}
                    disabled={!canDelete}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
