"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import {
  Trash2,
  AlertTriangle,
  Key,
  Loader2,
  CheckCircle,
  Ban,
  Shield,
  Clock,
  User,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ApiKeyDialog } from "./api-key-dialog";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
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

interface ApiKey {
  id: string;
  name: string;
  start: string;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastRequest?: string;
  requestCount?: string;
  createdByName?: string;
}

interface CicdSettingsProps {
  jobId: string;
  onChange?: () => void;
}

export function CicdSettings({ jobId, onChange }: CicdSettingsProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [operationLoadingStates, setOperationLoadingStates] = useState<{ [keyId: string]: 'toggle' | 'delete' | null }>({});

  // Check permissions for API key deletion (using job delete permission as proxy for API key management)
  const { currentProject } = useProjectContext();
  const userRole = currentProject?.userRole ? normalizeRole(currentProject.userRole) : null;
  const canDeleteApiKeys = userRole ? canDeleteJobs(userRole) : false;

  const loadApiKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/jobs/${jobId}/api-keys`);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Access denied. You don't have permission to view API keys for this job.");
        }
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setApiKeys(data.apiKeys || []);
    } catch (err) {
      console.error("Failed to load API keys:", err);
      setError(err instanceof Error ? err.message : "Failed to load API keys. Please refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) {
      loadApiKeys();
    }
  }, [jobId, loadApiKeys]);

  const handleApiKeyCreated = () => {
    loadApiKeys();
    if (onChange) onChange();
  };

  const handleDelete = async (keyId: string) => {
    setKeyToDelete(keyId);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!keyToDelete) return;

    try {
      setOperationLoadingStates(prev => ({ ...prev, [keyToDelete]: 'delete' }));

      const response = await fetch(`/api/jobs/${jobId}/api-keys/${keyToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete API key");
      }

      toast.success("API key deleted successfully");
      loadApiKeys();
      if (onChange) onChange();
    } catch (error) {
      console.error("Error deleting API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete API key");
    } finally {
      setShowDeleteDialog(false);
      setOperationLoadingStates(prev => ({ ...prev, [keyToDelete]: null }));
      setKeyToDelete(null);
    }
  };

  const handleToggleEnabled = async (keyId: string, currentEnabled: boolean) => {
    try {
      setOperationLoadingStates(prev => ({ ...prev, [keyId]: 'toggle' }));

      const response = await fetch(`/api/jobs/${jobId}/api-keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update API key");
      }

      toast.success(`API key ${!currentEnabled ? 'enabled' : 'disabled'} successfully`);
      loadApiKeys();
      if (onChange) onChange();
    } catch (error) {
      console.error("Error updating API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update API key");
    } finally {
      setOperationLoadingStates(prev => ({ ...prev, [keyId]: null }));
    }
  };

  const getExpiryStatus = (expiresAt: string | null) => {
    if (!expiresAt) return null;

    const now = new Date();
    const expiry = new Date(expiresAt);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { status: "expired", text: "Expired", className: "bg-red-500/10 text-red-500" };
    } else if (daysUntilExpiry <= 7) {
      return { status: "expiring", text: `Expires in ${daysUntilExpiry}d`, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" };
    }

    return null;
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            API Keys
          </CardTitle>
          <CardDescription>
            Create and manage API keys for automated job execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load API keys</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={loadApiKeys} className="ml-4 shrink-0">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* API Keys Section */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  API Keys
                </CardTitle>
                <CardDescription>
                  Create and manage API keys for automated job execution
                </CardDescription>
              </div>
              <ApiKeyDialog jobId={jobId} onApiKeyCreated={handleApiKeyCreated} />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <SuperCheckLoading size="sm" message="Loading API keys..." />
              </div>
            ) : apiKeys.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                  <Key className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium mb-1">No API keys yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Create your first API key to enable remote job triggering from your CI/CD pipelines.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {apiKeys.map((key) => {
                  const expiryStatus = getExpiryStatus(key.expiresAt);
                  const isExpired = expiryStatus?.status === "expired";
                  return (
                    <div
                      key={key.id}
                      className={cn(
                        "group flex items-center justify-between p-4 border rounded-lg transition-colors",
                        isExpired
                          ? "bg-red-500/5 border-red-500/20"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm">{key.name}</span>
                          {key.enabled && !isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                              Active
                            </span>
                          )}
                          {!key.enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                              Disabled
                            </span>
                          )}
                          {expiryStatus && (
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                              expiryStatus.className
                            )}>
                              {expiryStatus.text}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground flex-wrap ml-[26px]">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(key.createdAt), "MMM d, yyyy")}
                          </span>
                          <span>
                            {key.expiresAt
                              ? `Expires ${format(new Date(key.expiresAt), "MMM d, yyyy")}`
                              : "No expiry"}
                          </span>
                          {key.createdByName && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {key.createdByName}
                            </span>
                          )}
                          {key.lastRequest && (
                            <span>
                              Last used {format(new Date(key.lastRequest), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-4 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleToggleEnabled(key.id, key.enabled)}
                              disabled={operationLoadingStates[key.id] === 'toggle'}
                            >
                              {operationLoadingStates[key.id] === 'toggle' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : key.enabled ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Ban className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {key.enabled ? "Disable key" : "Enable key"}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-8 w-8",
                                canDeleteApiKeys
                                  ? "text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
                                  : "text-muted-foreground/50 cursor-not-allowed"
                              )}
                              onClick={() => handleDelete(key.id)}
                              disabled={!canDeleteApiKeys || operationLoadingStates[key.id] === 'delete'}
                            >
                              {operationLoadingStates[key.id] === 'delete' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {canDeleteApiKeys ? "Delete key" : "Insufficient permissions"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security Best Practices */}
        <Card className="bg-muted/30 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Security Best Practices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                Monitor and rotate API keys regularly for enhanced security
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                Set appropriate expiration dates for temporary access
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                Store keys securely using environment variables or secrets management
              </li>
              <li className="flex items-start gap-2">
                <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                Use descriptive names to identify key purposes
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                Delete API Key
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-2">
                Are you sure you want to delete this API key? Any CI/CD pipelines using
                this key will immediately lose the ability to trigger this job. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="pt-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={keyToDelete ? operationLoadingStates[keyToDelete] === 'delete' : false}
                className="bg-red-600 hover:bg-red-700"
              >
                {keyToDelete && operationLoadingStates[keyToDelete] === 'delete' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  'Delete Key'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
