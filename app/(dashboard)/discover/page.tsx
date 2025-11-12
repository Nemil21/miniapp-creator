"use client";

import { DiscoverMiniapps } from "@/components/DiscoverMiniapps";
import { useAuthContext } from "@/contexts/AuthContext";
import { useApiUtils } from "@/lib/apiUtils";
import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export default function DiscoverPage() {
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      if (!sessionToken) return;
      try {
        setIsLoading(true);
        const data = await apiCall<{ projects: Project[] }>("/api/projects", {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            "Content-Type": "application/json",
          },
        });
        setProjects(data.projects || []);
      } catch (error) {
        console.error("Failed to load discover projects:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProjects();
  }, [sessionToken, apiCall]);

  return (
    <div className="min-h-screen bg-background font-funnel-sans">
      <div className="mx-auto max-w-5xl px-6 py-10">
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
          <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
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
          <div className="p-4">
            <DiscoverMiniapps projects={projects} isLoading={isLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}
