'use client';

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ProjectList } from './ProjectList';
import { useAuthContext } from '../contexts/AuthContext';
import { usePrivy, useWallets } from '@privy-io/react-auth';

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
  const { user } = useAuthContext();
  const { logout } = usePrivy();
  const { wallets } = useWallets();
  const walletAddress = wallets[0]?.address;

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    openSidebar: () => setIsOpen(true),
    closeSidebar: () => setIsOpen(false)
  }));

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      
      // Open sidebar when mouse is within 50px of the left edge
      const threshold = 50;
      const isNearLeftEdge = e.clientX < threshold;
      
      if (isNearLeftEdge && !isOpen) {
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

  // Format wallet address
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get user display name
  const getUserDisplay = () => {
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email;
    return user?.privyUserId || '@minidev_user';
  };

  return (
    <>
      {/* Hover trigger zone - invisible area on the left edge */}
      <div 
        className="fixed top-0 left-0 w-[50px] h-full z-40 pointer-events-auto"
        style={{ pointerEvents: isOpen ? 'none' : 'auto' }}
      />

      {/* Backdrop when sidebar is open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar with theme styling - from left */}
      <div
        className={`fixed top-[20px] left-[20px] bottom-[20px] w-[420px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out rounded-[32px] ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={handleMouseLeave}
      >
        <div className="h-full flex flex-col">
          {/* Account Info Header */}
          <div className="p-6 border-b border-black-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <span className="text-white font-medium">
                    {getUserDisplay().charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-black">
                    {getUserDisplay()}
                  </span>
                  {walletAddress && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-black-60 font-mono">
                        {formatAddress(walletAddress)}
                      </span>
                      <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full">
                        Base
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Logout Button */}
              <button
                onClick={logout}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Logout"
              >
                <svg className="w-5 h-5 text-black-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>

          {/* Project List */}
          <div className="flex-1 overflow-hidden">
            <ProjectList
              onProjectSelect={handleProjectSelect}
              onNewProject={handleNewProject}
            />
          </div>
        </div>
      </div>
    </>
  );
});

