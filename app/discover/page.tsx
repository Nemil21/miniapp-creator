"use client";

import { DiscoverMiniapps } from "@/components/DiscoverMiniapps";
import AuthProvider from "@/app/providers";
import ProtectedRoute from "@/components/ProtectedRoute";
import { HoverSidebar, HoverSidebarRef } from "@/components/HoverSidebar";
import { UserProfileHeader } from "@/components/UserProfileHeader";
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
    username?: string;
    displayName?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// Hardcoded featured projects that appear at the top
const FEATURED_PROJECTS: Project[] = [
  {
    id: "95c3f567-adbf-417b-beb0-4ea2e1f7a6a7",
    name: "Chess Multiplayer Miniapp",
    description: "A multiplayer chess game for Farcaster",
    appLink: "https://95c3f567-adbf-417b-beb0-4ea2e1f7a6a7.minidev.fun",
    previewUrl: "https://95c3f567-adbf-417b-beb0-4ea2e1f7a6a7.minidev.fun",
    vercelUrl: "https://95c3f567-adbf-417b-beb0-4ea2e1f7a6a7.minidev.fun",
    creator: {
      pfpUrl: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/3d1d1747-c34a-4ce3-2e85-32e4aef63200/original",
      username: "jenil",  // Add this field
      displayName: "Jenil",
    },
    createdAt: "2025-12-01T19:43:55.000Z",
    updatedAt: "2025-12-01T19:49:03.000Z",
  },
  {
    id: "ae72cafe-533b-4228-b39b-e2e41efb59d7",
    name: "Christmas Tree Decorating Miniapp",
    description: "Decorate your own Christmas tree in this festive miniapp",
    appLink: "https://ae72cafe-533b-4228-b39b-e2e41efb59d7.minidev.fun",
    previewUrl: "https://ae72cafe-533b-4228-b39b-e2e41efb59d7.minidev.fun",
    vercelUrl: "https://ae72cafe-533b-4228-b39b-e2e41efb59d7.minidev.fun",
    creator: {
      pfpUrl: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/3d1d1747-c34a-4ce3-2e85-32e4aef63200/original",
      username: "jenil",  // Add this field
      displayName: "Jenil",
    },
    createdAt: "2025-11-29T15:52:24.000Z",
    updatedAt: "2025-11-29T16:21:13.000Z",
  },
  {
    id: "bd8ad780-ed07-4dce-995c-f838a1c72bbe",
    name: "Global Walking Distance Calculator App",
    description: "Calculate walking distances around the globe",
    appLink: "https://bd8ad780-ed07-4dce-995c-f838a1c72bbe.minidev.fun",
    previewUrl: "https://bd8ad780-ed07-4dce-995c-f838a1c72bbe.minidev.fun",
    vercelUrl: "https://bd8ad780-ed07-4dce-995c-f838a1c72bbe.minidev.fun",
    creator: {
      pfpUrl: "https://tba-mobile.mypinata.cloud/ipfs/QmdWiwqddvc8rD8egeQzNUkNaaTYvThJhrcZgUZquWHW8p?pinataGatewayToken=3nq0UVhtd3rYmgYDdb1I9qv7rHsw-_DzwdWkZPRQ-QW1avFI9dCS8knaSfq_R5_q",
      username: "coinbrad.base.eth",
      displayName: "coinbrad",
    },
    createdAt: "2025-12-01T22:10:17.000Z",
    updatedAt: "2025-12-01T22:40:55.000Z",
  },
  {
    id: "bf298c6b-a40e-4535-94f9-a826a7695a9b",
    name: "X402 Far Nft Collection Miniapp",
    description: "Explore the X402 NFT collection on Farcaster",
    appLink: "https://bf298c6b-a40e-4535-94f9-a826a7695a9b.minidev.fun",
    previewUrl: "https://bf298c6b-a40e-4535-94f9-a826a7695a9b.minidev.fun",
    vercelUrl: "https://bf298c6b-a40e-4535-94f9-a826a7695a9b.minidev.fun",
    creator: {
      pfpUrl: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/d9978686-a20e-4848-ec16-4355e8608500/original",
      displayName: "OG.base | 🧙‍♂️",
      username: "OG.base",
    },
    createdAt: "2025-12-02T15:03:46.000Z",
    updatedAt: "2025-12-02T15:03:48.000Z",
  },
  {
    id: "0175c0d2-6c77-4165-9884-97790dc36db8",
    name: "Interactive Kalimba Miniapp",
    description: "Play a virtual kalimba instrument",
    appLink: "https://0175c0d2-6c77-4165-9884-97790dc36db8.minidev.fun",
    previewUrl: "https://0175c0d2-6c77-4165-9884-97790dc36db8.minidev.fun",
    vercelUrl: "https://0175c0d2-6c77-4165-9884-97790dc36db8.minidev.fun",
    creator: {
      pfpUrl: "https://imagedelivery.net/BXluQx4ige9GuW0Ia56BHw/60f555bc-2141-46d0-3c5c-0db57374a100/original",
      displayName: "Sleve McDichael",
      username: "SleveMcDichael",
    },
    createdAt: "2025-12-01T16:59:40.000Z",
    updatedAt: "2025-12-01T16:59:42.000Z",
  },
];

function DiscoverContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const hoverSidebarRef = useRef<HoverSidebarRef>(null);
  const router = useRouter();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleProjectSelect = async (_project: { id: string; name: string; description?: string; appType?: 'farcaster'; previewUrl?: string; vercelUrl?: string; createdAt: string; updatedAt: string }) => {
    // Navigate back to home page with the selected project
    router.push('/');
  };

  const handleNewProject = () => {
    router.push('/');
  };

  const fetchProjects = async (currentOffset: number, append: boolean = false) => {
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      const response = await fetch(`/api/apps/published?limit=20&offset=${currentOffset}`);
      
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
          fid?: number;
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
          username: app.creator.username,
          displayName: app.creator.displayName,
        } : undefined,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
      }));
      
      // Filter out duplicates (featured projects that might also be in API response)
      const apiProjectsFiltered = transformedProjects.filter(
        p => !FEATURED_PROJECTS.some(fp => fp.id === p.id)
      );
      
      if (append) {
        // When loading more, just append API projects (featured already at top)
        setProjects(prev => [...prev, ...apiProjectsFiltered]);
      } else {
        // On initial load, prepend featured projects
        setProjects([...FEATURED_PROJECTS, ...apiProjectsFiltered]);
      }
      
      setHasMore(data.pagination?.hasMore || false);
      setOffset(currentOffset + transformedProjects.length);
    } catch (error) {
      console.error("Failed to load discover projects:", error);
      // Even if API fails, show featured projects on initial load
      if (!append) {
        setProjects(FEATURED_PROJECTS);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchProjects(0, false);
  }, []);

  // Infinite scroll handler
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || isLoading || isLoadingMore || !hasMore) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollBottom = scrollHeight - scrollTop - clientHeight;
      
      // Load more when user is within 200px of the bottom
      if (scrollBottom < 200) {
        fetchProjects(offset, true);
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [offset, isLoading, isLoadingMore, hasMore]);

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
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden bg-background"
        >
          <div className="mx-auto max-w-5xl px-3 sm:px-6 py-4">
            <div className="mb-8">
              <h1 className="mt-4 text-3xl font-semibold text-gray-900">
                Trending Miniapps
              </h1>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-gray-200 p-4 sm:p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
                    Featured Miniapps
                  </h2>
                </div>
              </div>
              <DiscoverMiniapps 
                projects={projects} 
                isLoading={isLoading}
                hasMore={hasMore}
              />
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
