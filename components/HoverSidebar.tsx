"use client";

import { DiscoverMiniapps } from "@/components/DiscoverMiniapps";
import { useAuthContext } from "@/contexts/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Button } from "./ui/button";
import { PlusIcon } from "lucide-react";

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
  isOpen: boolean;
  onToggle: () => void;
}

export interface HoverSidebarRef {
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const HoverSidebar = forwardRef<HoverSidebarRef, HoverSidebarProps>(
  function HoverSidebar(
    { onProjectSelect, onNewProject, isOpen, onToggle },
    ref
  ) {
    const { sessionToken } = useAuthContext();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const isDiscoverRoute = pathname === "/discover";

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      openSidebar: () => onToggle(),
      closeSidebar: () => onToggle(),
    }));

    // Load projects
    useEffect(() => {
      const loadProjects = async () => {
        if (!sessionToken) return;

        setIsLoading(true);
        try {
          const response = await fetch("/api/projects", {
            headers: { Authorization: `Bearer ${sessionToken}` },
          });

          if (response.ok) {
            const data = await response.json();
            setProjects(data.projects || []);
          }
        } catch (error) {
          console.error("Failed to load projects:", error);
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
      router.push("/");
    };

    // Get project initial for bubble
    const getProjectInitial = (name: string) => {
      return name.charAt(0).toUpperCase();
    };

    return (
      <div
        className={`h-screen bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
          isOpen ? "w-64" : "w-0 border-r-0 overflow-hidden"
        }`}
      >
        {isOpen && (
          <>
            <div className="flex-1 overflow-y-auto py-4 px-4">
              <div className="flex flex-col items-center gap-2 mb-4">
                <Button
                  variant="default"
                  onClick={handleNewProject}
                  title="New Project"
                  className="w-full justify-center gap-2"
                >
                  <PlusIcon className="w-5 h-5" />
                  <span className="text-sm font-medium text-gray-700">
                    New Project
                  </span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/discover")}
                  className={`flex-1 justify-center w-full font-semibold transition-colors ${
                    isDiscoverRoute
                      ? "bg-white shadow-sm border-gray-300 text-black"
                      : "text-gray-500 hover:text-black"
                  }`}
                >
                  Discover
                </Button>
              </div>

              <div className="flex flex-col items-center gap-3">
                {isLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                  </div>
                ) : (
                  projects.map((project) => (
                    <Button
                      key={project.id}
                      onClick={() => handleProjectSelect(project)}
                      variant="ghost"
                      title={project.name}
                      className="w-[calc(100%-24px)] justify-start gap-3 hover:bg-gray-100"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white font-medium text-xs">
                          {getProjectInitial(project.name)}
                        </span>
                      </div>
                      <div className="flex-1 text-left overflow-hidden">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {project.name}
                        </p>
                        {project.description && (
                          <p className="text-xs text-gray-500 truncate">
                            {project.description}
                          </p>
                        )}
                      </div>
                    </Button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);
