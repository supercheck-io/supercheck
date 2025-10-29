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
  Shield
} from "lucide-react";
import { toast } from "sonner";
import { ApiKeyDialog } from "./api-key-dialog";
import { useProjectContext } from "@/hooks/use-project-context";
import { canDeleteJobs } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
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
  const [operationLoadingStates, setOperationLoadingStates] = useState<{[keyId: string]: 'toggle' | 'delete' | null}>({});

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
      return { status: "expired", text: "Expired", className: "bg-red-100 text-red-800 border-red-200" };
    } else if (daysUntilExpiry <= 7) {
      return { status: "expiring", text: `Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`, className: "bg-orange-100 text-orange-800 border-orange-200" };
    }
    
    return null;
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">CI/CD Integration</CardTitle>
          <CardDescription>
            Configure API access for continuous integration and deployment workflows
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* API Keys Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-semibold">API Keys</CardTitle>
              <CardDescription>
                Create and manage API keys for automated job execution
              </CardDescription>
            </div>
            <ApiKeyDialog jobId={jobId} onApiKeyCreated={handleApiKeyCreated} />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Loading API keys...</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Please wait while we fetch your API keys</p>
                </div>
              </div>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-6">
              <Key className="h-6 w-6 text-muted-foreground/90 mx-auto mb-2" />
              <h3 className="text-sm font-medium text-muted-foreground mb-1">No API Keys</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Create your first API key to enable remote job triggering
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
                    className={`flex items-center justify-between p-3 border rounded-lg ${
                      isExpired ? 'bg-red-50 border-red-200' : 'bg-card'
                    }`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold text-sm">{key.name}</span>
                        {key.enabled && !isExpired && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800 border border-green-200">
                            Active
                          </span>
                        )}
                        {!key.enabled && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-800 border border-gray-200">
                            Disabled
                          </span>
                        )}
                        {expiryStatus && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${expiryStatus.className}`}>
                            {expiryStatus.text}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        <span>Created: {format(new Date(key.createdAt), "PPP")}</span>
                        <span className="mx-1">·</span>
                        <span>Expires: {key.expiresAt ? format(new Date(key.expiresAt), "PPP") : "No expiry"}</span>
                        {key.createdByName && <span className="mx-1">·</span>}
                        {key.createdByName && <span>Created by: {key.createdByName}</span>}
                        {key.lastRequest && <span className="mx-1">·</span>}
                        {key.lastRequest && <span>Last used: {format(new Date(key.lastRequest), "PPP")}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleEnabled(key.id, key.enabled)}
                          disabled={operationLoadingStates[key.id] === 'toggle'}
                        className={key.enabled ? "text-green-600 hover:text-green-700 hover:bg-green-50" : "text-gray-500 hover:text-gray-600 hover:bg-red-50"}
                          title={key.enabled ? "Disable key" : "Enable key"}
                        >
                          {operationLoadingStates[key.id] === 'toggle' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            key.enabled ? <CheckCircle className="h-4 w-4" /> : <Ban className="h-4 w-4" />
                          )}
                        </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(key.id)}
                        disabled={!canDeleteApiKeys || operationLoadingStates[key.id] === 'delete'}
                        className={`ml-1 ${!canDeleteApiKeys ? 'opacity-50 cursor-not-allowed text-muted-foreground' : 'text-red-600 hover:text-red-700 hover:bg-red-50'} disabled:opacity-50`}
                        title={canDeleteApiKeys ? "Delete key" : "Insufficient permissions to delete API keys"}
                      >
                        {operationLoadingStates[key.id] === 'delete' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Best Practices */}
      <div className="bg-muted/30 p-4 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-4 w-4 " />
          <h4 className="font-medium text-sm">  Security Best Practices:</h4>
        </div>
        <div className="text-xs text-muted-foreground space-y-2">
          <p>• Monitor and rotate API keys regularly for enhanced security</p>
          <p>• Set appropriate expiration dates for temporary access</p>
          <p>• Store keys securely using environment variables or secrets management</p>
          <p>• Use descriptive names to identify key purposes</p>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this API key? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={keyToDelete ? operationLoadingStates[keyToDelete] === 'delete' : false}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              {keyToDelete && operationLoadingStates[keyToDelete] === 'delete' ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </div>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 
    