'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
import { CodeGenerator } from './components/CodeGenerator';
import { ChatInterface, ChatInterfaceRef } from './components/ChatInterface';
import { HoverSidebar, HoverSidebarRef } from './components/HoverSidebar';
import { UserProfileHeader } from './components/UserProfileHeader';
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
  appType?: 'farcaster' | 'web3'; // Which boilerplate was used
}

function HomeContent() {
  const [currentProject, setCurrentProject] = useState<GeneratedProject | null>(null);
  const [projectForPreview, setProjectForPreview] = useState<GeneratedProject | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedAppType, setSelectedAppType] = useState<'farcaster' | 'web3'>('farcaster');
  const { sessionToken } = useAuthContext();
  const { apiCall } = useApiUtils();
  const chatInterfaceRef = useRef<ChatInterfaceRef>(null);
  const hoverSidebarRef = useRef<HoverSidebarRef>(null);
  const previewDelayTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Delay showing preview for new deployments to give Vercel time to deploy
  useEffect(() => {
    // Clear any existing timer
    if (previewDelayTimerRef.current) {
      clearTimeout(previewDelayTimerRef.current);
    }

    if (currentProject) {
      console.log('🔍 Project changed:', {
        projectId: currentProject.projectId,
        isNewDeployment: currentProject.isNewDeployment,
        hasVercelUrl: !!currentProject.vercelUrl,
        hasPreviewUrl: !!currentProject.previewUrl
      });

      // If it's a new deployment OR the project has a vercel/preview URL but we haven't shown it yet, wait
      // This handles both initial deployments and cases where deployment just completed
      const shouldWaitForDeployment = currentProject.isNewDeployment || 
        (currentProject.vercelUrl && !projectForPreview) || 
        (currentProject.previewUrl && !projectForPreview);

      if (shouldWaitForDeployment) {
        console.log('🕐 Deployment detected, waiting 10 seconds before showing preview...');
        previewDelayTimerRef.current = setTimeout(() => {
          console.log('✅ Preview delay complete, showing preview now');
          setProjectForPreview(currentProject);
        }, 10000); // Increased to 10 seconds for better reliability
      } else {
        // For existing projects or edits, show immediately
        console.log('📱 Showing preview immediately');
        setProjectForPreview(currentProject);
      }
    } else {
      // No project, clear preview
      console.log('🗑️ Clearing preview');
      setProjectForPreview(null);
    }

    // Cleanup timer on unmount
    return () => {
      if (previewDelayTimerRef.current) {
        clearTimeout(previewDelayTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject]);

  const handleProjectSelect = async (project: { id: string; name: string; description?: string; appType?: 'farcaster' | 'web3'; previewUrl?: string; vercelUrl?: string; createdAt: string; updatedAt: string }) => {
    try {
      console.log('🔍 handleProjectSelect called with project:', project);
      console.log('🔍 Attempting to fetch project with ID:', project.id);
      
      // Load project files and create a GeneratedProject object using apiCall
      const data = await apiCall<{ project: { id: string; name: string; description?: string; appType?: 'farcaster' | 'web3'; previewUrl?: string; vercelUrl?: string; files: unknown[]; chatMessages: unknown[] } }>(`/api/projects/${project.id}`, {
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
        appType: projectData.appType || 'farcaster', // Include appType from database
      };

      console.log('🔍 Generated project loaded:', {
        projectId: generatedProject.projectId,
        vercelUrl: generatedProject.vercelUrl,
        previewUrl: generatedProject.previewUrl,
        url: generatedProject.url,
        appType: generatedProject.appType,
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
    setProjectForPreview(null);
    setSelectedAppType('farcaster'); // Reset to default
    
    // Clear any preview delay timer
    if (previewDelayTimerRef.current) {
      clearTimeout(previewDelayTimerRef.current);
      previewDelayTimerRef.current = null;
    }
    
    // Clear chat and focus input
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.clearChat();
      
      // Focus input after a short delay to ensure render is complete
      setTimeout(() => {
        chatInterfaceRef.current?.focusInput();
      }, 100);
    }
  };

  const handleTemplateSelect = (appType: 'farcaster' | 'web3') => {
    console.log('🎯 Template selected:', appType);
    setSelectedAppType(appType);
    
    // Update ChatInterface's appType
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.setAppType(appType);
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen h-screen font-funnel-sans relative bg-white">
      {/* Thin Permanent Sidebar */}
      <HoverSidebar
        ref={hoverSidebarRef}
        onProjectSelect={handleProjectSelect}
        onNewProject={handleNewProject}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content - Chat and Preview */}
      <div className={`flex flex-1 transition-all duration-300 ${isSidebarOpen ? 'ml-0' : 'ml-0'}`}>
        {/* Left Section - Chat/Agent */}
        <section className="w-1/3 border-r border-gray-200 h-screen flex flex-col bg-white overflow-hidden">
          {/* User Profile Header - positioned above chat only */}
          <UserProfileHeader 
            onOpenSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
          
          {/* Chat Interface */}
          <ChatInterface
            ref={chatInterfaceRef}
            currentProject={currentProject}
            onProjectGenerated={setCurrentProject}
            onGeneratingChange={setIsGenerating}
            activeAgent={activeAgent || undefined}
            initialAppType={selectedAppType}
          />
        </section>

        {/* Right Section - Code/Preview */}
        <section className="w-2/3 h-screen bg-gray-50 transition-all duration-500">
          <CodeGenerator
            currentProject={projectForPreview}
            isGenerating={isGenerating || (!!currentProject && !projectForPreview)}
            onOpenSidebar={() => hoverSidebarRef.current?.openSidebar()}
            activeAgent={activeAgent || undefined}
            feeModelType={feeModelType}
            selectedAppType={selectedAppType}
            onSelectTemplate={handleTemplateSelect}
          />
        </section>
      </div>
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
