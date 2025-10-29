"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useState, useEffect, useCallback } from "react";
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

export default function Variables() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canCreateEdit, setCanCreateEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canViewSecrets, setCanViewSecrets] = useState(false);
  const [secretVisibility, setSecretVisibility] = useState<{ [key: string]: boolean }>({});
  const [decryptedValues, setDecryptedValues] = useState<{ [key: string]: string }>({});
  const [editDialogState, setEditDialogState] = useState<{ [key: string]: boolean }>({});
  const { projectId: currentProjectId, loading: projectLoading } = useProjectContext();

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetVariables = useCallback((variables: Variable[] | ((prev: Variable[]) => Variable[])) => {
    if (mounted) {
      setVariables(variables);
    }
  }, [mounted]);

  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (mounted) {
      setIsLoading(loading);
    }
  }, [mounted]);

  // Fetch variables from the database
  useEffect(() => {
    async function fetchVariables() {
      if (!currentProjectId || projectLoading) return;
      
      safeSetIsLoading(true);
      try {
        const response = await fetch(`/api/projects/${currentProjectId}/variables`);
        const data = await response.json();
        
        if (response.ok && data.success) {
          // Transform data to ensure faceted filtering works correctly
          const transformedVariables = (data.data || []).map((variable: VariableApiResponse): Variable => ({
            ...variable,
            isSecret: String(variable.isSecret) // Convert boolean to string for faceted filtering
          }));
          safeSetVariables(transformedVariables);
          setCanManage(data.canManage || false);
          setCanCreateEdit(data.canCreateEdit || false);
          setCanDelete(data.canDelete || false);
          setCanViewSecrets(data.canViewSecrets || false);
        } else {
          console.error("Failed to fetch variables:", data.error);
          safeSetVariables([]);
        }
      } catch (error) {
        console.error("Error fetching variables:", error);
        safeSetVariables([]);
      } finally {
        safeSetIsLoading(false);
      }
    }

    fetchVariables();
  }, [currentProjectId, projectLoading, safeSetVariables, safeSetIsLoading]);


  const handleDeleteVariable = (variableId: string) => {
    safeSetVariables((prevVariables) => prevVariables.filter((variable) => variable.id !== variableId));
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

  const handleSuccess = async () => {
    // Fetch fresh data from server after successful form submission
    if (!currentProjectId) return;

    try {
      const response = await fetch(`/api/projects/${currentProjectId}/variables`);
      const data = await response.json();

      if (data.success && data.data) {
        const transformedVariables = (data.data || []).map((variable: VariableApiResponse): Variable => ({
          ...variable,
          isSecret: String(variable.isSecret)
        }));
        safeSetVariables(transformedVariables);
        setCanCreateEdit(data.canCreateEdit || false);
        setCanDelete(data.canDelete || false);
        setCanViewSecrets(data.canViewSecrets || false);
      }
    } catch (error) {
      console.error('Error refreshing variables:', error);
    }
  };

  // Don't render until component is mounted or project is loading
  if (!mounted || projectLoading) {
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