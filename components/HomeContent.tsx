'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChatInterface, ChatInterfaceRef } from '@/components/ChatInterface';
import { CodeGenerator } from '@/components/CodeGenerator';
import { UserProfileHeader } from '@/components/UserProfileHeader';
import { useApiUtils } from '@/lib/apiUtils';
import { useProjectStore } from '@/store/useProjectStore';
import { EarnKit } from '@earnkit/earn';
import { useAuthContext } from '../contexts/AuthContext';

interface GeneratedProject {
  projectId: string;
  port: number;
  url: string;
  generatedFiles?: string[];
  previewUrl?: string;
  vercelUrl?: string;
  aliasSuccess?: boolean;
  isNewDeployment?: boolean;
  hasPackageChanges?: boolean;
}

const PANEL_WIDTH_STORAGE_KEY = 'miniapp-creator-left-panel-width';

export default function HomeContent() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isNavigatingHome, setIsNavigatingHome] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
      return saved ? parseFloat(saved) : 33.33; // Default to 1/3
    }
    return 33.33;
  });
  const [isDragging, setIsDragging] = useState(false);
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const chatInterfaceRef = useRef<ChatInterfaceRef>(null);
  const hasAppliedPromptRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const routeProjectId = typeof params?.projectId === 'string' ? params.projectId : null;
  const {
    currentProject,
    selectedProjectId,
    setCurrentProject,
    setSelectedProjectId,
    resetProjectState,
  } = useProjectStore();

  // Initialize EarnKit
  const activeAgent = useMemo(() => {
    const credsOff = process.env.NEXT_PUBLIC_CREDS_OFF === 'true';
    const agentId = process.env.NEXT_PUBLIC_EARNKIT_AGENT_ID;
    const apiKey = process.env.NEXT_PUBLIC_EARNKIT_API_KEY;
    
    console.log('🔧 EarnKit Initialization:', {
      credsOff,
      agentId: agentId ? `${agentId.substring(0, 8)}...` : 'missing',
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'missing',
      hasAgentId: !!agentId,
      hasApiKey: !!apiKey
    });
    
    // If credits are disabled, return null to disable the credit system
    if (credsOff) {
      console.log('💰 Credits disabled via CREDS_OFF flag');
      return null;
    }
    
    if (!agentId || !apiKey) {
      console.warn('⚠️ EarnKit credentials not configured');
      return null;
    }

    console.log('✅ EarnKit instance created successfully');
    return new EarnKit({
      agentId,
      apiKey,
    });
  }, []);
  
  const feeModelType: "free-tier" | "credit-based" = "credit-based";
  
  console.log('📊 HomeContent render:', {
    hasActiveAgent: !!activeAgent,
    feeModelType,
    hasCurrentProject: !!currentProject
  });

  // Debug currentProject changes
  useEffect(() => {
    console.log('🏠 currentProject state changed to:', currentProject ? 'present' : 'null');
  }, [currentProject]);

  const fetchProjectById = useCallback(async (projectId: string) => {
    console.log('🔍 Fetching project via query:', projectId);
    const data = await apiCall<{ project: { id: string; name: string; description?: string; previewUrl?: string; vercelUrl?: string; files: { filename: string }[]; chatMessages: unknown[] } }>(`/api/projects/${projectId}`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
    });

    const projectData = data.project;
    const generatedProject: GeneratedProject = {
      projectId: projectData.id,
      port: 3000,
      url: projectData.vercelUrl || projectData.previewUrl || '',
      generatedFiles: projectData.files?.map((f) => f.filename) || [],
      previewUrl: projectData.previewUrl,
      vercelUrl: projectData.vercelUrl,
      aliasSuccess: !!(projectData.vercelUrl || projectData.previewUrl),
      isNewDeployment: false,
      hasPackageChanges: false,
    };

    console.log('🔍 Project fetched via query:', {
      projectId: generatedProject.projectId,
      vercelUrl: generatedProject.vercelUrl,
      previewUrl: generatedProject.previewUrl,
      url: generatedProject.url,
    });

    return generatedProject;
  }, [apiCall, sessionToken]);

  const { data: fetchedProject, isFetching: isProjectLoading } = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => {
      if (!selectedProjectId) {
        throw new Error('No project selected');
      }
      return fetchProjectById(selectedProjectId);
    },
    enabled: !!selectedProjectId && !!sessionToken,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    initialData: () => {
      if (!selectedProjectId) return undefined;
      return queryClient.getQueryData<GeneratedProject>(['project', selectedProjectId]);
    },
  });

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    if (fetchedProject && fetchedProject.projectId === selectedProjectId) {
      setCurrentProject(fetchedProject);
    }
  }, [fetchedProject, selectedProjectId, setCurrentProject]);

  useEffect(() => {
    if (!selectedProjectId) {
      setCurrentProject(null);
    }
  }, [selectedProjectId, setCurrentProject]);

  const handleNewProject = useCallback(({ redirect = true }: { redirect?: boolean } = {}) => {
    console.log('🆕 handleNewProject called - clearing current project');
    if (selectedProjectId) {
      queryClient.removeQueries({ queryKey: ['project', selectedProjectId] });
    }
    resetProjectState();
    if (redirect) {
      setIsNavigatingHome(true);
      router.push('/', { scroll: false });
    }
    
    // Clear chat and focus input
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.clearChat();
      
      // Focus input after a short delay to ensure render is complete
      setTimeout(() => {
        chatInterfaceRef.current?.focusInput();
      }, 100);
    }
  }, [resetProjectState, router, selectedProjectId, queryClient]);

  useEffect(() => {
    if (routeProjectId) {
      if (!isNavigatingHome && routeProjectId !== selectedProjectId) {
        setSelectedProjectId(routeProjectId);
      }
    } else {
      if (selectedProjectId) {
        setSelectedProjectId(null);
      }
      if (isNavigatingHome) {
        setIsNavigatingHome(false);
      }
    }
  }, [routeProjectId, selectedProjectId, isNavigatingHome, setSelectedProjectId]);

  useEffect(() => {
    const promptParam = searchParams?.get('prompt');
    if (!promptParam || hasAppliedPromptRef.current) {
      return;
    }

    hasAppliedPromptRef.current = true;
    handleNewProject({ redirect: false });
    router.replace('/', { scroll: false });

    setTimeout(() => {
      chatInterfaceRef.current?.sendMessage(promptParam);
    }, 0);
  }, [searchParams, handleNewProject, router]);

  // Save panel width to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, leftPanelWidth.toString());
    }
  }, [leftPanelWidth]);

  // Handle drag for resizing panels
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

      // Constrain between 20% and 70%
      const constrainedWidth = Math.max(20, Math.min(70, newLeftWidth));
      setLeftPanelWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div ref={containerRef} className="flex h-screen bg-white">
      {/* Left Section - Chat/Agent */}
      <section 
        className="w-full lg:w-auto h-full flex flex-col bg-white overflow-hidden transition-all duration-200"
        style={{ 
          width: typeof window !== 'undefined' && window.innerWidth >= 1024 
            ? `${leftPanelWidth}%` 
            : undefined 
        }}
      >
        <UserProfileHeader />

        <ChatInterface
          ref={chatInterfaceRef}
          currentProject={currentProject}
          onProjectGenerated={(project) => {
            if (project) {
              setSelectedProjectId(project.projectId);
              setCurrentProject(project);
              queryClient.setQueryData(['project', project.projectId], project);
              router.push(`/${project.projectId}`, { scroll: false });
            } else {
              resetProjectState();
              router.push('/', { scroll: false });
            }
          }}
          onGeneratingChange={setIsGenerating}
          activeAgent={activeAgent || undefined}
        />
      </section>

      {/* Draggable Separator */}
      <div
        className={`hidden lg:flex items-center justify-center w-px bg-gray-200 ring-0 hover:ring-3 hover:ring-primary cursor-col-resize transition-all duration-100 ${
          isDragging ? 'bg-border' : ''
        }`}
        onMouseDown={handleMouseDown}
        style={{ userSelect: 'none' }}
      >
        <div className="w-0.5 h-full bg-border" />
      </div>

      {/* Right Section - Code/Preview */}
      <section 
        className="hidden lg:block h-full bg-gray-50 transition-all duration-200"
        style={{ width: `${100 - leftPanelWidth}%` }}
      >
        <CodeGenerator
          currentProject={currentProject}
          isGenerating={isGenerating}
          isProjectLoading={isProjectLoading}
          activeAgent={activeAgent || undefined}
          feeModelType={feeModelType}
        />
      </section>
    </div>
  );
}

