/**
 * Supercheck Recorder - Project Selector Component
 *
 * Dropdown component for selecting the target project.
 */

import * as React from 'react';
import { apiClient, type Project } from '../api-client';
import { getConfig, saveConfig } from '../config';

interface ProjectSelectorProps {
  onProjectChange?: (project: Project | null) => void;
  disabled?: boolean;
}

export function ProjectSelector({ onProjectChange, disabled }: ProjectSelectorProps) {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Load projects on mount
  React.useEffect(() => {
    async function loadProjects() {
      setLoading(true);
      setError(null);

      try {
        const config = await getConfig();
        if (!config?.apiKey) {
          setError('Not connected to Supercheck');
          setLoading(false);
          return;
        }

        const projectList = await apiClient.getProjects();
        setProjects(projectList);

        // Select previously selected project or first one
        const lastProjectId = config.lastProjectId;
        if (lastProjectId && projectList.some(p => p.id === lastProjectId)) {
          setSelectedProjectId(lastProjectId);
          onProjectChange?.(projectList.find(p => p.id === lastProjectId) || null);
        } else if (projectList.length > 0) {
          setSelectedProjectId(projectList[0].id);
          onProjectChange?.(projectList[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }

    loadProjects();
  }, [onProjectChange]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = e.target.value;
    setSelectedProjectId(projectId);

    const project = projects.find(p => p.id === projectId) || null;
    onProjectChange?.(project);

    // Persist selection
    if (projectId)
      await saveConfig({ lastProjectId: projectId });

  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);

    try {
      const projectList = await apiClient.getProjects();
      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh projects');
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className='project-selector error'>
        <span className='error-text'>{error}</span>
        <button onClick={handleRefresh} className='refresh-btn' title='Retry'>
          ↻
        </button>
      </div>
    );
  }

  return (
    <div className='project-selector'>
      <select
        value={selectedProjectId || ''}
        onChange={handleChange}
        disabled={disabled || loading}
        className='project-select'
      >
        {loading ? (
          <option value=''>Loading projects...</option>
        ) : projects.length === 0 ? (
          <option value=''>No projects found</option>
        ) : (
          projects.map(project => (
            <option key={project.id} value={project.id}>
              {project.organizationName ? `${project.organizationName} / ` : ''}{project.name}
            </option>
          ))
        )}
      </select>
      <button
        onClick={handleRefresh}
        className='refresh-btn'
        title='Refresh projects'
        disabled={loading}
      >
        ↻
      </button>
    </div>
  );
}
