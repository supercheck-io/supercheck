"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { NotificationProviderForm } from "@/components/alerts/notification-provider-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Bell } from "lucide-react";
import { DataTable } from "@/components/alerts/data-table";
import { columns, type AlertHistory } from "@/components/alerts/columns";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { toast } from "sonner";
import { NotificationChannelsComponent } from "@/components/alerts/notification-channels-component";
import { NotificationChannel } from "@/components/alerts/notification-channels-schema";
import { type NotificationProviderType, type NotificationProviderConfig } from "@/db/schema";
import { useProjectContext } from "@/hooks/use-project-context";
import { canCreateNotifications } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";

type NotificationProvider = {
  id: string;
  name: string;
  type: NotificationProviderType;
  config: NotificationProviderConfig;
  isEnabled: boolean;
  createdAt: string;
  updatedAt?: string;
  lastUsed?: string;
  isInUse?: boolean;
  maskedFields?: string[];
};

export default function AlertsPage() {
  const [providers, setProviders] = useState<NotificationProvider[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertHistory[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  
  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateNotifications(normalizedRole);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<NotificationProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<NotificationProvider | null>(null);
  const [loading, setLoading] = useState(true);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Alerts", isCurrentPage: true },
  ];

  useEffect(() => {
    // Load providers from API and alert history
    const loadData = async () => {
      try {
        const [providersResponse, historyResponse] = await Promise.all([
          fetch('/api/notification-providers'),
          fetch('/api/alerts/history')
        ]);
        
        if (providersResponse.ok) {
          const data = await providersResponse.json();
          // Transform the data to match our interface
          const transformedData: NotificationProvider[] = data.map((provider: NotificationProvider) => ({
            id: provider.id,
            name: provider.name,
            type: provider.type,
            config: provider.config,
            isEnabled: provider.isEnabled,
            createdAt: provider.createdAt,
            updatedAt: provider.updatedAt,
            lastUsed: provider.lastUsed,
            maskedFields: provider.maskedFields || [],
          }));
          setProviders(transformedData);
        } else {
          console.error('Failed to fetch notification providers');
          setProviders([]);
        }

        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          setAlertHistory(historyData);
        } else {
          const errorText = await historyResponse.text();
          console.error('Failed to fetch alert history:', historyResponse.status, errorText);
          setAlertHistory([]);
        }
      } catch (error) {
        console.error('Error loading data:', error);
        setProviders([]);
        setAlertHistory([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);



  const handleCreateProvider = async (newProvider: {
    type: string;
    config: Record<string, unknown>;
  }) => {
    try {
      const response = await fetch('/api/notification-providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: (newProvider.config as Record<string, unknown>)?.name || `New ${newProvider.type} Channel`,
          type: newProvider.type,
          config: newProvider.config,
        }),
      });

      if (response.ok) {
        const createdProvider = await response.json();
        setProviders(prev => [...prev, createdProvider]);
        setIsCreateDialogOpen(false);
        toast.success("Notification channel created successfully");
      } else {
        const errorData = await response.json();
        console.error('Failed to create notification provider:', errorData);
        toast.error("Failed to create notification channel", {
          description: errorData.error || "Please try again",
        });
      }
    } catch (error) {
      console.error('Error creating notification provider:', error);
      toast.error("Failed to create notification channel", {
        description: "An unexpected error occurred",
      });
    }
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
      try {
        const response = await fetch(`/api/notification-providers/${editingProvider.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: (updatedProvider.config as Record<string, unknown>)?.name || editingProvider.name,
            type: updatedProvider.type,
            config: updatedProvider.config,
          }),
        });

        if (response.ok) {
          const updated = await response.json();
          setProviders(prev => prev.map(p => p.id === editingProvider.id ? updated : p));
          setIsEditDialogOpen(false);
          setEditingProvider(null);
          toast.success("Notification channel updated successfully");
        } else {
          const errorData = await response.json();
          console.error('Failed to update notification provider:', errorData);
          toast.error("Failed to update notification channel", {
            description: errorData.error || "Please try again",
          });
        }
      } catch (error) {
        console.error('Error updating notification provider:', error);
        toast.error("Failed to update notification channel", {
          description: "An unexpected error occurred",
        });
      }
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      const response = await fetch(`/api/notification-providers/${providerId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setProviders(prev => prev.filter(p => p.id !== providerId));
        setIsDeleteDialogOpen(false);
        setDeletingProvider(null);
        toast.success("Notification channel deleted successfully");
      } else {
        const errorData = await response.json();
        console.error('Failed to delete notification provider:', errorData.error || response.statusText);
        toast.error("Failed to delete notification channel", {
          description: errorData.error || errorData.details || "Please try again",
        });
      }
    } catch (error) {
      console.error('Error deleting notification provider:', error);
      toast.error("Failed to delete notification channel", {
        description: "An unexpected error occurred",
      });
    }
  };

  const handleDeleteProviderWithConfirmation = (provider: NotificationProvider) => {
    setDeletingProvider(provider);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteProvider = async () => {
    if (deletingProvider) {
      // Check if provider is in use before deleting
      try {
        const response = await fetch(`/api/notification-providers/${deletingProvider.id}/usage`);
        if (response.ok) {
          const usageData = await response.json();
          if (usageData.isInUse) {
            // Close the dialog first
            setIsDeleteDialogOpen(false);
            setDeletingProvider(null);
            
            // Show error toast - provider is in use
            toast.error("Cannot delete provider", {
              description: "This channel is currently being used by one or more monitors or jobs. Please remove it first to delete it.",
            });
            return;
          }
        }
      } catch (error) {
        console.error('Error checking provider usage:', error);
        toast.error("Error checking provider usage", {
          description: "Unable to verify if provider is in use. Please try again.",
        });
        return;
      }

      await handleDeleteProvider(deletingProvider.id);
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

  return (
    <div className="">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="mx-auto p-4">
        <div className="">
          <Card >
            <Tabs defaultValue="history" className="w-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <TabsList className="grid w-full max-w-md grid-cols-2">
                    <TabsTrigger value="providers">Notification Channels</TabsTrigger>
                    <TabsTrigger value="history">Alert History</TabsTrigger>
                  </TabsList>
                  <div className="flex items-center space-x-2">
                    <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                      <DialogTrigger asChild>
                        <Button disabled={!canCreate}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add Channel
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Create Notification Channel</DialogTitle>
                          <DialogDescription>
                            Add a new way to receive alert notifications
                          </DialogDescription>
                        </DialogHeader>
                        <NotificationProviderForm
                          onSuccess={handleCreateProvider}
                          onCancel={() => setIsCreateDialogOpen(false)}
                        />
                      </DialogContent>
                    </Dialog>

                    <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
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

                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Notification Channel</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &quot;{((deletingProvider?.config as Record<string, unknown>)?.name as string) || deletingProvider?.type}&quot;? 
                            <br/>
                            <br/>
                           <strong>Note: </strong> This action cannot be undone. Make sure this channel is not being used by any monitors or jobs.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => {
                            setIsDeleteDialogOpen(false);
                            setDeletingProvider(null);
                          }}>
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
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <TabsContent value="providers">
                  <div className="space-y-4">
                    <div>
                      <CardTitle className="text-2xl font-semibold">Notification Channels</CardTitle>
                      <CardDescription>
                        Configure how you want to receive alerts
                      </CardDescription>
                    </div>
                    
                    {providers.length === 0 ? (
                      <div className="text-center py-8">
                        <Bell className="h-10 w-10 text-muted-foreground mx-auto" />
                        <h3 className="text-lg font-medium">No notification channels</h3>
                        <p className="text-muted-foreground text-sm mb-4">
                          Add your first notification channel to start receiving alerts
                        </p>
                       
                      </div>
                    ) : (
                      <NotificationChannelsComponent
                        onEditChannel={handleEditChannel}
                        onDeleteChannel={handleDeleteChannel}
                      />
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-2">
                  <div className="h-full flex-1 flex-col md:flex">
                    {alertHistory.length === 0 && !loading ? (
                      <>   
                      <div>
                        <CardTitle className="text-2xl font-semibold">Alert History</CardTitle>
                        <CardDescription>
                          View the history of alerts
                        </CardDescription>
                      </div>
                      <div className="text-center py-12">
                        <Bell className="h-10 w-10 text-muted-foreground mx-auto" />
                        <h3 className="text-lg font-medium">No alerts found</h3>
                        <p className="text-muted-foreground text-sm">
                          Alerts will appear here when your monitors or jobs trigger notifications
                        </p>
                      </div>
                      </>
                    ) : (
                      <DataTable columns={columns} data={alertHistory} isLoading={loading} />
                    )}
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </div>
    </div>
  );
}
