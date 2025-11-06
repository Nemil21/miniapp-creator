'use client';
import { logger } from "../../lib/logger";


import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useApiUtils } from '../../lib/apiUtils';

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListProps {
  onProjectSelect: (project: Project) => void;
  onNewProject: () => void;
}

export function ProjectList({ onProjectSelect, onNewProject }: ProjectListProps) {
  const { isAuthenticated, sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await apiCall<{ projects: Project[] }>('/api/projects', {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      setProjects(data.projects || []);
    } catch (err) {
      logger.error('Error fetching projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [sessionToken, apiCall]);

  useEffect(() => {
    if (isAuthenticated && sessionToken) {
      fetchProjects();
    }
  }, [isAuthenticated, sessionToken, fetchProjects]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getProjectUrl = (project: Project) => {
    return project.previewUrl || project.vercelUrl || '#';
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-white rounded-lg">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-black-60 text-sm text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
            Loading your projects...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col bg-white rounded-lg">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-red-600 text-sm text-center">
            <div className="mb-4">⚠️ Error loading projects</div>
            <div className="text-xs text-black-60 mb-4">{error}</div>
            <button
              onClick={fetchProjects}
              className="px-4 py-2 bg-black text-white rounded hover:bg-black-80 transition-colors text-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="h-full flex flex-col bg-white rounded-lg">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-black-60 text-sm text-center">
            <div className="mb-4">📁 No projects yet</div>
            <div className="text-xs text-black-40 mb-6">
              Create your first miniapp to get started
            </div>
            <button
              onClick={onNewProject}
              className="px-4 py-2 bg-black text-white rounded hover:bg-black-80 transition-colors text-sm"
            >
              Create New Project
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-lg">
      {/* Header */}
      <div className="p-4 border-b border-black-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-black">Your Projects</h2>
            <p className="text-sm text-black-60">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => {
              onNewProject();
            }}
            className="px-3 py-2 bg-black text-white rounded hover:bg-black-80 transition-colors text-sm font-medium"
          >
            + New Project
          </button>
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="border border-black-10 rounded-lg p-4 hover:border-black-20 hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => onProjectSelect(project)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-black truncate group-hover:text-black-80">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-sm text-black-60 mt-1 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-black-40">
                    <span>Updated {formatDate(project.updatedAt)}</span>
                    {getProjectUrl(project) !== '#' && (
                      <span className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        Live
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {getProjectUrl(project) !== '#' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(getProjectUrl(project), '_blank');
                      }}
                      className="p-2 text-black-40 hover:text-black hover:bg-black-5 rounded transition-colors"
                      title="Open in new tab"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectSelect(project);
                    }}
                    className="px-3 py-1 bg-black text-white rounded hover:bg-black-80 transition-colors text-xs font-medium"
                  >
                    Open
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
