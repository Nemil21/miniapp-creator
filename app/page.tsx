'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
import { CodeGenerator } from './components/CodeGenerator';
import { ChatInterface, ChatInterfaceRef } from './components/ChatInterface';
import { HoverSidebar, HoverSidebarRef } from './components/HoverSidebar';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { useApiUtils } from '../lib/apiUtils';
import { EarnKit } from '@earnkit/earn';


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

function HomeContent() {
  const [currentProject, setCurrentProject] = useState<GeneratedProject | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const chatInterfaceRef = useRef<ChatInterfaceRef>(null);
  const hoverSidebarRef = useRef<HoverSidebarRef>(null);

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

  const handleProjectSelect = async (project: { id: string; name: string; description?: string; previewUrl?: string; vercelUrl?: string; createdAt: string; updatedAt: string }) => {
    try {
      console.log('🔍 handleProjectSelect called with project:', project);
      console.log('🔍 Attempting to fetch project with ID:', project.id);
      
      // Load project files and create a GeneratedProject object using apiCall
      const data = await apiCall<{ project: { id: string; name: string; description?: string; previewUrl?: string; vercelUrl?: string; files: unknown[]; chatMessages: unknown[] } }>(`/api/projects/${project.id}`, {
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('🔍 Project API response data:', data);
      const projectData = data.project;

      // Convert database project to GeneratedProject format
      const generatedProject: GeneratedProject = {
        projectId: projectData.id,
        port: 3000, // Default port
        url: projectData.vercelUrl || projectData.previewUrl || '',
        generatedFiles: (projectData.files as { filename: string }[])?.map((f: { filename: string }) => f.filename) || [],
        previewUrl: projectData.previewUrl,
        vercelUrl: projectData.vercelUrl,
        aliasSuccess: !!(projectData.vercelUrl || projectData.previewUrl),
        isNewDeployment: false,
        hasPackageChanges: false,
      };

      console.log('🔍 Generated project loaded:', {
        projectId: generatedProject.projectId,
        vercelUrl: generatedProject.vercelUrl,
        previewUrl: generatedProject.previewUrl,
        url: generatedProject.url,
      });

      setCurrentProject(generatedProject);
    } catch (error) {
      console.error('Error loading project:', error);
      // You might want to show an error message to the user
    }
  };

  const handleNewProject = () => {
    console.log('🆕 handleNewProject called - clearing current project');
    setCurrentProject(null);
    
    // Clear chat and focus input
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.clearChat();
      
      // Focus input after a short delay to ensure render is complete
      setTimeout(() => {
        chatInterfaceRef.current?.focusInput();
      }, 100);
    }
  };

  return (
    <div className="flex min-h-screen h-[calc(100vh-40px)] font-funnel-sans relative bg-pink p-[20px]">
      {/* Left Section - Chat/Agent */}
      <section className="w-1/3 border-r border-black/10 h-[calc(100vh-40px)] flex flex-col rounded-tl-[56px] rounded-bl-[56px] bg-white">
        <ChatInterface
          ref={chatInterfaceRef}
          currentProject={currentProject}
          onProjectGenerated={setCurrentProject}
          onGeneratingChange={setIsGenerating}
          activeAgent={activeAgent || undefined}
        />
      </section>

      {/* Right Section - Code/Preview */}
      <section className="w-2/3 h-[calc(100vh-40px)] bg-white transition-all duration-500 rounded-tr-[56px] rounded-br-[56px] dot-bg">
        <CodeGenerator
          currentProject={currentProject}
          isGenerating={isGenerating}
          onOpenSidebar={() => hoverSidebarRef.current?.openSidebar()}
          activeAgent={activeAgent || undefined}
          feeModelType={feeModelType}
        />
      </section>

      {/* Hover Sidebar for Projects */}
      <HoverSidebar
        ref={hoverSidebarRef}
        onProjectSelect={handleProjectSelect}
        onNewProject={handleNewProject}
      />
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <HomeContent />
      </ProtectedRoute>
    </AuthProvider>
  );
}
