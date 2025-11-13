'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

interface Project {
  id: string;
  name: string;
  description?: string;
  appType?: 'farcaster' | 'web3';
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface HoverSidebarProps {
  onProjectSelect: (project: Project) => void;
  onNewProject: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export interface HoverSidebarRef {
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const HoverSidebar = forwardRef<HoverSidebarRef, HoverSidebarProps>(
  function HoverSidebar({ onProjectSelect, onNewProject, isOpen, onToggle }, ref) {
  const { sessionToken } = useAuthContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    openSidebar: () => onToggle(),
    closeSidebar: () => onToggle()
  }));

  // Load projects
  useEffect(() => {
    const loadProjects = async () => {
      if (!sessionToken) return;
      
      setIsLoading(true);
      try {
        const response = await fetch('/api/projects', {
          headers: { 'Authorization': `Bearer ${sessionToken}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          // Sort projects by most recent first (updatedAt)
          const sortedProjects = (data.projects || []).sort((a: Project, b: Project) => {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          });
          setProjects(sortedProjects);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProjects();
  }, [sessionToken]);

  const handleProjectSelect = (project: Project) => {
    onProjectSelect(project);
  };

  const handleNewProject = () => {
    onNewProject();
  };

  // Get project initial for bubble
  const getProjectInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <div className={`h-screen bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${isOpen ? 'w-64' : 'w-0 border-r-0 overflow-hidden'}`}>
      {isOpen && (
        <>
          {/* Projects Section */}
          <div className="flex-1 overflow-y-auto py-4">
            <div className="flex flex-col items-center gap-3">
              {/* New Project Button */}
              <button
                onClick={handleNewProject}
                className="flex items-center justify-center transition-all rounded-lg hover:bg-gray-100 w-full mx-3 px-3 py-2"
                title="New Project"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="ml-2 text-sm font-medium text-gray-700">New Project</span>
              </button>

              {/* Project List */}
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectSelect(project)}
                    className="flex items-center transition-all rounded-lg w-full mx-3 px-3 justify-start"
                    title={project.name}
                  >
                    {/* <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-medium text-xs">
                        {getProjectInitial(project.name)}
                      </span>
                    </div> */}
                    <div className="flex items-center justify-start hover:bg-gray-200 rounded-lg w-full py-2">
                    <div className="ml-3 flex-1 text-left overflow-hidden">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {project.name}
                      </p>
                      {/* {project.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {project.description}
                        </p>
                      )} */}
                    </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

