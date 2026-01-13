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
  projectId: string | null;
  projectName: string | null;
}

const ProjectContextContext = createContext<ProjectContextState | null>(null);

interface ProjectsCache {
  currentProject: ProjectContext | null;
  projects: ProjectContext[];
  timestamp: number;
}

let projectsCache: ProjectsCache | null = null;
const CACHE_TTL = 30000;

export function clearProjectsCache(): void {
  projectsCache = null;
}

export function useProjectContext(): ProjectContextState {
  const context = useContext(ProjectContextContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectContextProvider');
  }
  return context;
}

export function useProjectContextSafe(): ProjectContextState | null {
  return useContext(ProjectContextContext);
}

export interface ProjectContextHydrationProps {
  initialProjects?: ProjectContext[];
  initialCurrentProject?: ProjectContext | null;
}

export function useProjectContextState(
  hydrationProps?: ProjectContextHydrationProps
): ProjectContextState {
  const hasServerData = hydrationProps?.initialProjects !== undefined;
  const initialProjectsValue = hasServerData 
    ? hydrationProps.initialProjects 
    : (projectsCache?.projects || []);
  const initialCurrentProjectValue = hasServerData
    ? (hydrationProps.initialCurrentProject ?? null)
    : (projectsCache?.currentProject || null);
  
  const [currentProject, setCurrentProject] = useState<ProjectContext | null>(initialCurrentProjectValue);
  const [projects, setProjects] = useState<ProjectContext[]>(initialProjectsValue!);
  const [loading, setLoading] = useState(!hasServerData && !projectsCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasServerData && !projectsCache && initialProjectsValue && initialProjectsValue.length >= 0) {
      projectsCache = {
        projects: initialProjectsValue,
        currentProject: initialCurrentProjectValue,
        timestamp: Date.now(),
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasServerData]);

  const fetchProjects = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && projectsCache && (now - projectsCache.timestamp) < CACHE_TTL) {
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
        if (response.status === 403 && data.error?.includes('Insufficient permissions')) {
          setProjects([]);
          setCurrentProject(null);
          projectsCache = { projects: [], currentProject: null, timestamp: Date.now() };
          return;
        }
        throw new Error(data.error || 'Failed to fetch projects');
      }

      if (data.success && Array.isArray(data.data)) {
        let newCurrentProject: ProjectContext | null = null;
        
        if (data.currentProject) {
          newCurrentProject = data.currentProject;
        } else if (data.data.length > 0) {
          newCurrentProject = data.data.find((p: ProjectContext) => p.isDefault) || data.data[0];
        }
        
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to switch project');
      }

      if (data.success && data.project) {
        setCurrentProject(data.project);
        sessionStorage.setItem('projectSwitchSuccess', data.project.name);
        await new Promise(resolve => setTimeout(resolve, 200));
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
    await fetchProjects(true);
  }, [fetchProjects]);

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
    projectId: currentProject?.id || null,
    projectName: currentProject?.name || null,
  };
}

interface ProjectContextProviderProps {
  children: React.ReactNode;
  initialProjects?: ProjectContext[];
  initialCurrentProject?: ProjectContext | null;
}

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