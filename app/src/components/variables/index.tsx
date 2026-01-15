"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { useProjectContext } from "@/hooks/use-project-context";
import { Variable } from "./schema";

// Type for variable data as returned from API (before transformation)
interface VariableApiResponse {
  id: string;
  key: string;
  value?: string;
  isSecret: boolean; // API returns boolean
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
  const [canManage, setCanManage] = useState(false);
  const [canCreateEdit, setCanCreateEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canViewSecrets, setCanViewSecrets] = useState(false);
  const [secretVisibility, setSecretVisibility] = useState<{ [key: string]: boolean }>({});
  const [decryptedValues, setDecryptedValues] = useState<{ [key: string]: string }>({});
  const [editDialogState, setEditDialogState] = useState<{ [key: string]: boolean }>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { projectId: currentProjectId, loading: projectLoading } = useProjectContext();

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

  // Set mounted ref on mount/unmount (for async callback safety)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
          isSecret: String(variable.isSecret) // Convert boolean to string for faceted filtering
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
      } else {
        console.error("Failed to fetch variables:", data.error);
        setVariables([]);
      }
    } catch (error) {
      console.error("Error fetching variables:", error);
      if (mountedRef.current) {
        setVariables([]);
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsInitialLoad(false);
      }
      fetchingRef.current = false;
    }
  }, [currentProjectId, projectLoading]);

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
  }, []);

  // Don't render until component is mounted (prevents hydration mismatch)
  if (!isMounted) {
    return (
      <div className="flex h-full flex-col p-2 mt-6">
        <DataTableSkeleton columns={5} rows={2} />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col p-2 mt-6">
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
      </div>

    </>
  );
}