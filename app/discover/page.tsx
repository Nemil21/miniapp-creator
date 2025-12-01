"use client";

import { DiscoverMiniapps } from "../components/DiscoverMiniapps";
import { AuthProvider } from "../contexts/AuthContext";
import ProtectedRoute from "../components/ProtectedRoute";
import { HoverSidebar, HoverSidebarRef } from "../components/HoverSidebar";
import { UserProfileHeader } from "../components/UserProfileHeader";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  appLink?: string;
  creator?: {
    pfpUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

function DiscoverContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const hoverSidebarRef = useRef<HoverSidebarRef>(null);
  const router = useRouter();

  const handleProjectSelect = (project: Project) => {
    // Navigate back to home page with the selected project
    router.push('/');
  };

  const handleNewProject = () => {
    router.push('/');
  };

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('https://miniapp-creator-mobile-production.up.railway.app/api/apps/published?limit=20&offset=0');
        // Use local API endpoint with mock data
        // const response = await fetch('/api/apps/published?limit=20&offset=0');
        
        if (!response.ok) {
          throw new Error('Failed to fetch published apps');
        }
        
        const data = await response.json();
        
        // Transform the API response to match our Project interface
        const transformedProjects: Project[] = (data.apps || []).map((app: {
          id: string;
          name: string;
          description?: string;
          appLink?: string;
          creator?: {
            fid: number;
            username?: string;
            displayName?: string;
            pfpUrl?: string;
          };
          createdAt: string;
          updatedAt: string;
        }) => ({
          id: app.id,
          name: app.name,
          description: app.description,
          appLink: app.appLink,
          previewUrl: app.appLink, // Use appLink as previewUrl for compatibility
          vercelUrl: app.appLink, // Use appLink as vercelUrl for compatibility
          creator: app.creator ? {
            pfpUrl: app.creator.pfpUrl,
          } : undefined,
          createdAt: app.createdAt,
          updatedAt: app.updatedAt,
        }));
        
        setProjects(transformedProjects);
      } catch (error) {
        console.error("Failed to load discover projects:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, []);

  return (
    <div className="flex min-h-screen h-screen font-funnel-sans relative bg-white overflow-hidden">
      {/* Thin Permanent Sidebar */}
      <HoverSidebar
        ref={hoverSidebarRef}
        onProjectSelect={handleProjectSelect}
        onNewProject={handleNewProject}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* User Profile Header */}
        <UserProfileHeader 
          onOpenSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        />

        {/* Discover Content */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="mx-auto max-w-5xl px-6 py-4">
            <div className="mb-8">
              <h1 className="mt-4 text-3xl font-semibold text-gray-900">
                Trending Miniapps
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                Explore AI-generated Farcaster miniapps created by the community.
                Click try to launch the live experience.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Featured Miniapps
                  </h2>
                  <p className="text-xs text-gray-500">
                    {projects.length} project{projects.length !== 1 ? "s" : ""}{" "}
                    discovered
                  </p>
                </div>
              </div>
                <DiscoverMiniapps projects={projects} isLoading={isLoading} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <DiscoverContent />
      </ProtectedRoute>
    </AuthProvider>
  );
}

