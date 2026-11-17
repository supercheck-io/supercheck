"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { useProjectContext } from "@/hooks/use-project-context";
import { Variable } from "./schema";
import { ListErrorState } from "@/components/shared/list-states";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { NAV } from "@/lib/nav-areas";
import { VariableDialog } from "./variable-dialog";
import { VariablesHelp } from "./variables-help";

// Type for variable data as returned from API (before transformation)
interface VariableApiResponse {
  id: string;
  key: string;
  value?: string;
  isSecret: boolean; // API returns boolean
  type?: "variable" | "secret" | "file";
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  storagePath?: string | null;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Variables component - Manage project environment variables
 * 
 * Uses direct fetch with useEffect pattern - this works reliably with the
 * project-scoped API.
 */
export default function Variables() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canCreateEdit, setCanCreateEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canViewSecrets, setCanViewSecrets] = useState(false);
  const [secretVisibility, setSecretVisibility] = useState<{ [key: string]: boolean }>({});
  const [decryptedValues, setDecryptedValues] = useState<{ [key: string]: string }>({});
  const [editDialogState, setEditDialogState] = useState<{ [key: string]: boolean }>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { projectId: currentProjectId, loading: projectLoading } = useProjectContext();
  const searchParams = useSearchParams();
  const router = useRouter();

  // The Add variable dialog opens from `?create=true` (and `?type=`) as well as the button.
  const [dialogOpen, setDialogOpen] = useState(
    () => searchParams.get("create") === "true"
  );
  // Set while we close the dialog ourselves, so the URL change does not reopen it.
  const closingRef = useRef(false);
  const initialOpenHandled = useRef(false);
  const urlType = searchParams.get("type");
  const defaultType = (urlType === "secret" || urlType === "file") ? urlType : undefined;

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      closingRef.current = true;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("create");
      params.delete("type");
      router.replace(params.toString() ? `/variables?${params.toString()}` : "/variables", { scroll: false });
    }
    setDialogOpen(open);
  };

  useEffect(() => {
    // The initial open is handled by the useState initializer.
    if (!initialOpenHandled.current) {
      initialOpenHandled.current = true;
      return;
    }
    if (closingRef.current) {
      closingRef.current = false;
      return;
    }
    if (searchParams.get("create") === "true" && !dialogOpen) {
      // Defer to avoid synchronous setState in the effect body
      setTimeout(() => setDialogOpen(true), 0);
    }
  }, [searchParams, dialogOpen]);

  // Hydration-safe mounted state - prevents mismatch between server and client
  // Server returns false, client returns true after hydration
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Use refs to avoid dependency chain issues with useCallback
  // mountedRef is used for async callbacks to prevent state updates after unmount
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);
  const loadedProjectRef = useRef<string | null>(null);

  // Set mounted ref on mount/unmount (for async callback safety)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep any rows already loaded; only the first load shows the error panel.
  const reportLoadError = useCallback((message?: string) => {
    if (!mountedRef.current) return;
    const text = message || "The variables could not be loaded.";
    // Rows from another project must not stay visible under this one
    if (loadedProjectRef.current !== currentProjectId) {
      setVariables([]);
      setCanManage(false);
      setCanCreateEdit(false);
      setCanDelete(false);
      setCanViewSecrets(false);
    }
    setLoadError(text);
    toast.error("Failed to load variables", { description: text });
  }, [currentProjectId]);

  // Fetch variables from the database
  const fetchVariables = useCallback(async () => {
    // Guard: skip if no project, still loading project, or already fetching
    if (!currentProjectId || projectLoading || fetchingRef.current) {
      return;
    }

    fetchingRef.current = true;
    setIsLoading(true);

    try {
      const response = await fetch(`/api/projects/${currentProjectId}/variables`);
      const data = await response.json();

      // Only update state if still mounted
      if (!mountedRef.current) return;

      if (response.ok && data.success) {
        // Transform data to ensure faceted filtering works correctly
        const transformedVariables = (data.data || []).map((variable: VariableApiResponse): Variable => ({
          ...variable,
          isSecret: String(variable.isSecret), // Convert boolean to string for faceted filtering
          // Normalize type: legacy CLI-created secrets have type="variable" + isSecret=true
          type: (variable.isSecret && variable.type !== "secret" && variable.type !== "file") ? "secret" : (variable.type || "variable"),
        }));
        // Sort by createdAt descending (newest first)
        transformedVariables.sort((a: Variable, b: Variable) => {
          const dateA = new Date(a.createdAt || 0).getTime();
          const dateB = new Date(b.createdAt || 0).getTime();
          return dateB - dateA;
        });
        setVariables(transformedVariables);
        setCanManage(data.canManage || false);
        setCanCreateEdit(data.canCreateEdit || false);
        setCanDelete(data.canDelete || false);
        setCanViewSecrets(data.canViewSecrets || false);
        setLoadError(null);
        loadedProjectRef.current = currentProjectId;
      } else {
        console.error("Failed to fetch variables:", data.error);
        reportLoadError(data.error);
      }
    } catch (error) {
      console.error("Error fetching variables:", error);
      reportLoadError();
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsInitialLoad(false);
      }
      fetchingRef.current = false;
    }
  }, [currentProjectId, projectLoading, reportLoadError]);

  // Fetch when project changes or refresh is triggered
  useEffect(() => {
    if (currentProjectId && !projectLoading) {
      fetchVariables();
    }
  }, [currentProjectId, projectLoading, refreshTrigger, fetchVariables]);


  const handleDeleteVariable = (variableId: string) => {
    setVariables((prevVariables: Variable[]) => prevVariables.filter((variable: Variable) => variable.id !== variableId));
  };

  const handleToggleSecretVisibility = async (variableId: string) => {
    const currentVisibility = secretVisibility[variableId];
    const newVisibility = !currentVisibility;

    // If showing the secret, fetch the decrypted value
    if (newVisibility && !decryptedValues[variableId] && currentProjectId) {
      try {
        const response = await fetch(
          `/api/projects/${currentProjectId}/variables/${variableId}/decrypt`,
          {
            method: 'POST',
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.data?.value) {
            setDecryptedValues(prev => ({
              ...prev,
              [variableId]: data.data.value
            }));
          }
        }
      } catch (error) {
        console.error("Error decrypting secret:", error);
      }
    }

    setSecretVisibility(prev => ({
      ...prev,
      [variableId]: newVisibility
    }));
  };

  const handleSetEditDialogState = (variableId: string, open: boolean) => {
    setEditDialogState(prev => ({
      ...prev,
      [variableId]: open
    }));
  };

  const handleSuccess = useCallback(() => {
    // Trigger a refresh by incrementing the refreshTrigger
    setRefreshTrigger(prev => prev + 1);
    // The secret may have changed: drop cached plaintext so reveal and the edit dialog refetch it
    setDecryptedValues({});
    setSecretVisibility({});
  }, []);

  // Don't render until component is mounted (prevents hydration mismatch)
  if (!isMounted) {
    return (
      <div className="space-y-4">
        <DataTableSkeleton columns={5} rows={2} />
      </div>
    );
  }

  if (loadError && variables.length === 0) {
    return (
      <ListErrorState
        title="Failed to fetch variables"
        error={new Error(loadError)}
        onRetry={() => setRefreshTrigger(prev => prev + 1)}
      />
    );
  }

  const canAdd = canManage || canCreateEdit;
  const isEmpty = !isLoading && variables.length === 0;
  const addButton = currentProjectId ? (
    <Button onClick={() => setDialogOpen(true)} disabled={!canAdd}>
      <Plus className="mr-2 h-4 w-4" />
      Add variable
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Variables"
        icon={NAV.variables.icon}
        tone={NAV.variables.tone}
        titleAdornment={<VariablesHelp />}
        description="Manage configuration values, secrets and file datasets"
        actions={isEmpty ? undefined : addButton}
      />
      {isEmpty ? (
        <DashboardEmptyState
          className="min-h-[420px]"
          title="No variables yet"
          description={
            canAdd
              ? "Add a variable, secret or file to use in your Playwright and k6 scripts."
              : "No variables have been added to this project yet. Ask a project editor or administrator to add one."
          }
          icon={<NAV.variables.icon className="h-10 w-10" />}
          action={addButton}
        />
      ) : (
        <DataTable
          key={refreshTrigger}
          columns={columns}
          data={variables}
          isLoading={isLoading}
          meta={{
            onDeleteVariable: handleDeleteVariable,
            onToggleSecretVisibility: handleToggleSecretVisibility,
            secretVisibility: secretVisibility,
            decryptedValues: decryptedValues,
            projectId: currentProjectId,
            onSuccess: handleSuccess,
            canManage,
            canCreateEdit,
            canDelete,
            canViewSecrets,
            editDialogState: editDialogState,
            setEditDialogState: handleSetEditDialogState,
          }}
        />
      )}
      {currentProjectId && canAdd && (
        <VariableDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          projectId={currentProjectId}
          onSuccess={() => {
            handleSuccess();
            handleDialogOpenChange(false);
          }}
          defaultIsSecret={defaultType === "secret"}
          defaultType={defaultType}
        />
      )}
    </div>
  );
}
