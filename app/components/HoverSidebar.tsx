'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ProjectList } from './ProjectList';

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface HoverSidebarProps {
  onProjectSelect: (project: Project) => void;
  onNewProject: () => void;
}

export interface HoverSidebarRef {
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const HoverSidebar = forwardRef<HoverSidebarRef, HoverSidebarProps>(
  function HoverSidebar({ onProjectSelect, onNewProject }, ref) {
  const [isOpen, setIsOpen] = useState(false);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    openSidebar: () => setIsOpen(true),
    closeSidebar: () => setIsOpen(false)
  }));

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      
      // Open sidebar when mouse is within 50px of the right edge
      const threshold = 50;
      const isNearRightEdge = window.innerWidth - e.clientX < threshold;
      
      if (isNearRightEdge && !isOpen) {
        setIsOpen(true);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isOpen]);

  // Close sidebar when mouse moves away from it
  const handleMouseLeave = () => {
    setIsOpen(false);
  };

  const handleProjectSelect = (project: Project) => {
    onProjectSelect(project);
    setIsOpen(false); // Close sidebar when project is selected
  };

  const handleNewProject = () => {
    onNewProject();
    setIsOpen(false); // Close sidebar when new project is clicked
  };

  return (
    <>
      {/* Hover trigger zone - invisible area on the right edge */}
      <div 
        className="fixed top-0 right-0 w-[50px] h-full z-40 pointer-events-auto"
        style={{ pointerEvents: isOpen ? 'none' : 'auto' }}
      />

      {/* Sidebar with theme styling */}
      <div
        className={`fixed top-[20px] right-[20px] bottom-[20px] w-[420px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out rounded-[32px] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseLeave={handleMouseLeave}
      >
        <div className="h-full flex flex-col p-6">
          {/* Close button */}
          <button
            onClick={() => setIsOpen(false)}
            className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-lg transition-colors z-10"
            title="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Project List */}
          <div className="flex-1 overflow-hidden">
            <ProjectList
              onProjectSelect={handleProjectSelect}
              onNewProject={handleNewProject}
            />
          </div>
        </div>
      </div>

      {/* Backdrop when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
});

