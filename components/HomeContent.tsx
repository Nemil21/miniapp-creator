'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CodeGenerator } from '@/components/CodeGenerator';
import { ChatInterface, ChatInterfaceRef } from '@/components/ChatInterface';
import { UserProfileHeader } from '@/components/UserProfileHeader';
import { useAuthContext } from '../contexts/AuthContext';
import { useApiUtils } from '@/lib/apiUtils';
import { EarnKit } from '@earnkit/earn';
import { useProjectStore } from '@/store/useProjectStore';

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

export default function HomeContent() {
  const [isGenerating, setIsGenerating] = useState(false);
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const chatInterfaceRef = useRef<ChatInterfaceRef>(null);
  const hasAppliedPromptRef = useRef(false);
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
    if (routeProjectId && routeProjectId !== selectedProjectId) {
      setSelectedProjectId(routeProjectId);
    }
  }, [routeProjectId, selectedProjectId, setSelectedProjectId]);

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

  return (
    <div className="flex h-screen bg-white">
      {/* Left Section - Chat/Agent */}
      <section className="w-full lg:w-1/3 border-r border-gray-200 h-full flex flex-col bg-white overflow-hidden">
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

      {/* Right Section - Code/Preview */}
      <section className="hidden lg:block w-2/3 h-full bg-gray-50 transition-all duration-500">
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

