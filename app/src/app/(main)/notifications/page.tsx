"use client";

import React, { useState, useEffect, Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter, useSearchParams } from "next/navigation";
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
import { NotificationProviderForm } from "@/components/alerts/notification-provider-form";
import { Plus, BellRing } from "lucide-react";
import Link from "next/link";
import { InfoTip } from "@/components/ui/info-tip";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { toast } from "sonner";
import { NotificationChannelsComponent } from "@/components/alerts/notification-channels-component";
import { NotificationChannel } from "@/components/alerts/notification-channels-schema";
import {
  type NotificationProviderType,
  type NotificationProviderConfig,
} from "@/db/schema";
import { useProjectContext } from "@/hooks/use-project-context";
import { canCreateNotifications } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import {
  useNotificationProviders,
  useNotificationProviderMutations,
  type NotificationProvider,
} from "@/hooks/use-alerts";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { ListErrorState } from "@/components/shared/list-states";

function NotificationsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const router = useRouter();

  const { providers, isLoading: providersLoading, error: providersError, refetch: refetchProviders } = useNotificationProviders();
  const { createProvider, updateProvider, deleteProvider } = useNotificationProviderMutations();

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateNotifications(normalizedRole);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<NotificationProvider | null>(null);
  const [deletingProvider, setDeletingProvider] =
    useState<NotificationProvider | null>(null);
  const searchParams = useSearchParams();
  const [preselectedType, setPreselectedType] = useState<
    NotificationProviderType | undefined
  >(undefined);

  useEffect(() => {
    const create = searchParams.get("create");
    const type = searchParams.get("type");

    if (create === "true" && canCreate) {
      if (
        type &&
        ["email", "slack", "webhook", "telegram", "discord", "teams"].includes(type)
      ) {
        setPreselectedType(type as NotificationProviderType);
      }
      setIsCreateDialogOpen(true);
    }
  }, [searchParams, canCreate]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Notifications", isCurrentPage: true },
  ];

  const handleCreateProvider = async (newProvider: {
    type: string;
    config: Record<string, unknown>;
  }) => {
    await createProvider.mutateAsync(newProvider);
    handleCreateDialogChange(false);
    toast.success("Notification channel created successfully");
  };

  const handleEditProvider = (provider: NotificationProvider) => {
    setEditingProvider(provider);
    setIsEditDialogOpen(true);
  };

  const handleUpdateProvider = async (updatedProvider: {
    type: string;
    config: Record<string, unknown>;
  }) => {
    if (editingProvider) {
      await updateProvider.mutateAsync({
        id: editingProvider.id,
        type: updatedProvider.type,
        config: updatedProvider.config,
      });
      setIsEditDialogOpen(false);
      setEditingProvider(null);
      toast.success("Notification channel updated successfully");
    }
  };

  const handleDeleteProviderWithConfirmation = (
    provider: NotificationProvider
  ) => {
    setDeletingProvider(provider);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteProvider = async () => {
    if (deletingProvider) {
      // Check if provider is in use before deleting
      try {
        const response = await fetch(
          `/api/notification-providers/${deletingProvider.id}/usage`
        );
        if (response.ok) {
          const usageData = await response.json();
          if (usageData.isInUse) {
            // Close the dialog first
            setIsDeleteDialogOpen(false);
            setDeletingProvider(null);

            // Show error toast - provider is in use
            toast.error("Cannot delete provider", {
              description:
                "This channel is currently being used by one or more monitors or jobs. Please remove it first to delete it.",
            });
            return;
          }
        }
      } catch (error) {
        console.error("Error checking provider usage:", error);
        toast.error("Error checking provider usage", {
          description:
            "Unable to verify if provider is in use. Please try again.",
        });
        return;
      }

      try {
        await deleteProvider.mutateAsync(deletingProvider.id);
        toast.success("Notification channel deleted successfully");
      } catch (error) {
        console.error("Error deleting provider:", error);
        toast.error("Failed to delete notification channel");
      } finally {
        setIsDeleteDialogOpen(false);
        setDeletingProvider(null);
      }
    }
  };

  const handleEditChannel = (channel: NotificationChannel) => {
    const provider: NotificationProvider = {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      config: channel.config,
      isEnabled: channel.isEnabled,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      lastUsed: channel.lastUsed,
    };
    handleEditProvider(provider);
  };

  const handleDeleteChannel = (channel: NotificationChannel) => {
    const provider: NotificationProvider = {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      config: channel.config,
      isEnabled: channel.isEnabled,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      lastUsed: channel.lastUsed,
    };
    handleDeleteProviderWithConfirmation(provider);
  };

  const openCreateDialog = (type?: NotificationProviderType) => {
    setPreselectedType(type);
    setIsCreateDialogOpen(true);
  };

  const handleCreateDialogChange = (open: boolean) => {
    setIsCreateDialogOpen(open);
    if (!open) {
      setPreselectedType(undefined);
      const params = new URLSearchParams(searchParams.toString());
      if (params.has("create") || params.has("type")) {
        params.delete("create");
        params.delete("type");
        const nextQuery = params.toString();
        router.replace(nextQuery ? `/notifications?${nextQuery}` : "/notifications", {
          scroll: false,
        });
      }
    }
  };


  return (
    <div className="">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="">
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 m-4">
          <CardContent className="p-6">
            <div className="space-y-4">
              <PageHeader
                title="Notifications"
                description="Choose where Supercheck sends alerts and incident updates"
                titleAdornment={
                  <InfoTip label="About channels">
                    Channels are where Supercheck notifies your team about
                    alerts and incidents. Status-page subscribers are managed
                    on each status page.
                  </InfoTip>
                }
                actions={
                  providers.length > 0 || providersLoading ? (
                    <Button onClick={() => openCreateDialog()} disabled={!canCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create channel
                    </Button>
                  ) : null
                }
              />

              {providersError ? (
                <ListErrorState title="Failed to fetch notification channels" error={providersError} onRetry={() => refetchProviders()} />
              ) : providers.length === 0 && !providersLoading ? (
                <DashboardEmptyState
                  className="min-h-[360px]"
                  title="No notification channels"
                  description="Add your first notification channel to start receiving alerts"
                  icon={<BellRing className="h-12 w-12" />}
                  action={
                    <Button onClick={() => openCreateDialog()} disabled={!canCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create channel
                    </Button>
                  }
                />
              ) : (
                <NotificationChannelsComponent
                  onEditChannel={handleEditChannel}
                  onDeleteChannel={handleDeleteChannel}
                  providersData={providers.map((p) => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    config: p.config,
                    isEnabled: p.isEnabled,
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt || p.createdAt,
                    lastUsed: p.lastUsed,
                    createdByName: p.createdByName ?? null,
                    createdByImage: p.createdByImage ?? null,
                  }))}
                  refreshTrigger={0}
                />
              )}

              <p className="text-sm text-muted-foreground">
                Recent deliveries are listed in the{" "}
                <Link
                  href="/incidents?tab=alerts&view=history"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  delivery history
                </Link>
                .
              </p>
            </div>

            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={handleCreateDialogChange}
            >
              <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
                <DialogHeader className="shrink-0 border-b px-6 py-4 pr-14">
                  <DialogTitle>Create Notification Channel</DialogTitle>
                  <DialogDescription>
                    Add a new way to receive alert notifications
                  </DialogDescription>
                </DialogHeader>
                <NotificationProviderForm
                  onSuccess={handleCreateProvider}
                  onCancel={() => handleCreateDialogChange(false)}
                  defaultType={preselectedType}
                />
              </DialogContent>
            </Dialog>

            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
              <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
                <DialogHeader className="shrink-0 border-b px-6 py-4 pr-14">
                  <DialogTitle>Edit Notification Channel</DialogTitle>
                  <DialogDescription>
                    Update your notification channel settings
                  </DialogDescription>
                </DialogHeader>
                {editingProvider && (
                  <NotificationProviderForm
                    initialData={editingProvider}
                    onSuccess={handleUpdateProvider}
                    onCancel={() => {
                      setIsEditDialogOpen(false);
                      setEditingProvider(null);
                    }}
                  />
                )}
              </DialogContent>
            </Dialog>

            <AlertDialog
              open={isDeleteDialogOpen}
              onOpenChange={setIsDeleteDialogOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Notification Channel</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &quot;
                    {((
                      deletingProvider?.config as Record<string, unknown>
                    )?.name as string) || deletingProvider?.type}
                    &quot;?
                    <br />
                    <br />
                    <strong>Note: </strong> This action cannot be undone. Make
                    sure this channel is not being used by any monitors or jobs.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => {
                      setIsDeleteDialogOpen(false);
                      setDeletingProvider(null);
                    }}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmDeleteProvider}
                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div >
  );
}

export default function NotificationsPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <SupercheckLoading size="md" message="Loading notifications..." />
        </div>
      }
    >
      <NotificationsPage />
    </Suspense>
  );
}
