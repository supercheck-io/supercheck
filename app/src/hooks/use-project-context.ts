"use client";

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { toast } from 'sonner';

export interface ProjectContext {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  organizationId: string;
  isDefault: boolean;
  userRole: string;
}

interface ProjectContextState {
  currentProject: ProjectContext | null;
  projects: ProjectContext[];
  loading: boolean;
  error: string | null;
  switchProject: (projectId: string) => Promise<boolean>;
  refreshProjects: () => Promise<void>;
  // Backward compatibility
  projectId: string | null;
  projectName: string | null;
}

const ProjectContextContext = createContext<ProjectContextState | null>(null);

/**
 * Hook to access project context
 */
export function useProjectContext(): ProjectContextState {
  const context = useContext(ProjectContextContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectContextProvider');
  }
  return context;
}

/**
 * Project context state management
 */
export function useProjectContextState(): ProjectContextState {
  const [currentProject, setCurrentProject] = useState<ProjectContext | null>(null);
  const [projects, setProjects] = useState<ProjectContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/api/projects');
      const data = await response.json();

      if (!response.ok) {
        // Handle specific permission errors more gracefully during user setup
        if (response.status === 403 && data.error?.includes('Insufficient permissions')) {
          console.log('Permission error during project fetch - likely new user setup issue');
          // Don't throw error, just set empty projects to allow setup flow to continue
          setProjects([]);
          setCurrentProject(null);
          return;
        }
        throw new Error(data.error || 'Failed to fetch projects');
      }

      if (data.success && Array.isArray(data.data)) {
        setProjects(data.data);
        
        // Set current project from API response
        if (data.currentProject) {
          setCurrentProject(data.currentProject);
        } else if (data.data.length > 0) {
          // Fallback to default or first project
          const defaultProject = data.data.find((p: ProjectContext) => p.isDefault) || data.data[0];
          setCurrentProject(defaultProject);
        }
      } else {
        setProjects([]);
        setCurrentProject(null);
      }
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setProjects([]);
      setCurrentProject(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const switchProject = useCallback(async (projectId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/projects/switch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to switch project');
      }

      if (data.success && data.project) {
        setCurrentProject(data.project);
        
        // Store project name for toast after redirect
        sessionStorage.setItem('projectSwitchSuccess', data.project.name);
        
        // Add a small delay to ensure database transaction is committed before redirect
        // This prevents race conditions where the redirect happens before session is updated
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Redirect to root URL to prevent access to resources that don't belong to the new project
        window.location.href = '/';
        return true;
      } else {
        throw new Error(data.error || 'Failed to switch project');
      }
    } catch (err) {
      console.error('Error switching project:', err);
      const message = err instanceof Error ? err.message : 'Failed to switch project';
      toast.error(message);
      return false;
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    await fetchProjects();
  }, [fetchProjects]);

  // Load projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return {
    currentProject,
    projects,
    loading,
    error,
    switchProject,
    refreshProjects,
    // Backward compatibility
    projectId: currentProject?.id || null,
    projectName: currentProject?.name || null,
  };
}

/**
 * Provider component for project context
 */
export function ProjectContextProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const contextState = useProjectContextState();
  return React.createElement(
    ProjectContextContext.Provider,
    { value: contextState },
    children
  );
} 