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

// ============================================================================
// MODULE-LEVEL CACHE (prevents refetch on every component mount)
// ============================================================================
interface ProjectsCache {
  currentProject: ProjectContext | null;
  projects: ProjectContext[];
  timestamp: number;
}

let projectsCache: ProjectsCache | null = null;
const CACHE_TTL = 30000; // 30 seconds - projects rarely change

/**
 * Clear the module-level projects cache
 * Call this on sign-out to prevent data leakage between sessions
 */
export function clearProjectsCache(): void {
  projectsCache = null;
}

/**
 * Hook to access project context
 * @throws Error if used outside ProjectContextProvider
 */
export function useProjectContext(): ProjectContextState {
  const context = useContext(ProjectContextContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectContextProvider');
  }
  return context;
}

/**
 * Safe hook to access project context without throwing
 * Returns null if used outside ProjectContextProvider
 * Use this for components that may render outside the provider
 */
export function useProjectContextSafe(): ProjectContextState | null {
  return useContext(ProjectContextContext);
}

/**
 * Props for server-side hydration of project context
 */
export interface ProjectContextHydrationProps {
  /** Pre-fetched projects from server */
  initialProjects?: ProjectContext[];
  /** Pre-fetched current project from server */
  initialCurrentProject?: ProjectContext | null;
}

/**
 * Project context state management
 * PERFORMANCE OPTIMIZATION: Uses module-level cache to prevent
 * duplicate API calls when navigating between pages.
 * Also prefetches dashboard data as soon as project is available.
 * 
 * SERVER-SIDE HYDRATION:
 * When initialProjects and initialCurrentProject are provided (from server),
 * the state initializes immediately without loading state, eliminating
 * the client-side waterfall.
 */
export function useProjectContextState(
  hydrationProps?: ProjectContextHydrationProps
): ProjectContextState {
  // PERFORMANCE: Use server-provided data if available, else fall back to cache
  const hasServerData = hydrationProps?.initialProjects !== undefined;
  const initialProjectsValue = hasServerData 
    ? hydrationProps.initialProjects 
    : (projectsCache?.projects || []);
  const initialCurrentProjectValue = hasServerData
    ? (hydrationProps.initialCurrentProject ?? null)
    : (projectsCache?.currentProject || null);
  
  const [currentProject, setCurrentProject] = useState<ProjectContext | null>(initialCurrentProjectValue);
  const [projects, setProjects] = useState<ProjectContext[]>(initialProjectsValue!);
  // PERFORMANCE: If server provided data, skip loading state entirely
  const [loading, setLoading] = useState(!hasServerData && !projectsCache);
  const [error, setError] = useState<string | null>(null);
  
  // Populate module cache with server data for subsequent navigations
  // Only run once when server data is first available
  useEffect(() => {
    if (hasServerData && !projectsCache && initialProjectsValue && initialProjectsValue.length >= 0) {
      projectsCache = {
        projects: initialProjectsValue,
        currentProject: initialCurrentProjectValue,
        timestamp: Date.now(),
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run on mount with server data
  }, [hasServerData]);

  const fetchProjects = useCallback(async (forceRefresh = false) => {
    // Use cache if available and not expired (unless force refresh)
    const now = Date.now();
    if (!forceRefresh && projectsCache && (now - projectsCache.timestamp) < CACHE_TTL) {
      // Use cached data - no API call needed
      setProjects(projectsCache.projects);
      setCurrentProject(projectsCache.currentProject);
      setLoading(false);
      return;
    }

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
          projectsCache = { projects: [], currentProject: null, timestamp: Date.now() };
          return;
        }
        throw new Error(data.error || 'Failed to fetch projects');
      }

      if (data.success && Array.isArray(data.data)) {
        let newCurrentProject: ProjectContext | null = null;
        
        // Set current project from API response
        if (data.currentProject) {
          newCurrentProject = data.currentProject;
        } else if (data.data.length > 0) {
          // Fallback to default or first project
          newCurrentProject = data.data.find((p: ProjectContext) => p.isDefault) || data.data[0];
        }
        
        // Update module-level cache
        projectsCache = {
          projects: data.data,
          currentProject: newCurrentProject,
          timestamp: Date.now(),
        };
        
        setProjects(data.data);
        setCurrentProject(newCurrentProject);
      } else {
        setProjects([]);
        setCurrentProject(null);
        projectsCache = { projects: [], currentProject: null, timestamp: Date.now() };
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
    await fetchProjects(true); // Force refresh - bypass cache
  }, [fetchProjects]);

  // Load projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // NOTE: Dashboard prefetch moved to DataPrefetcher for consistency
  // All entity prefetching is now centralized there

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

interface ProjectContextProviderProps {
  children: React.ReactNode;
  /** Pre-fetched projects from server for instant hydration */
  initialProjects?: ProjectContext[];
  /** Pre-fetched current project from server for instant hydration */
  initialCurrentProject?: ProjectContext | null;
}

/**
 * Provider component for project context
 * 
 * PERFORMANCE OPTIMIZATION:
 * Pass initialProjects and initialCurrentProject from server-side rendering
 * to eliminate the client-side loading state and project fetch waterfall.
 */
export function ProjectContextProvider({ 
  children, 
  initialProjects,
  initialCurrentProject 
}: ProjectContextProviderProps): React.ReactElement {
  const contextState = useProjectContextState({ 
    initialProjects, 
    initialCurrentProject 
  });
  return React.createElement(
    ProjectContextContext.Provider,
    { value: contextState },
    children
  );
} 