'use client';

import { useState, useEffect } from 'react';
import { ProjectList } from './ProjectList';

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
    lastUpdated?: number; // Timestamp to track when project was last updated
}

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface PreviewProps {
    currentProject: GeneratedProject | null;
    onProjectSelect?: (project: Project) => void;
    onNewProject?: () => void;
}

export function Preview({ currentProject, onProjectSelect, onNewProject }: PreviewProps) {
    const [iframeError, setIframeError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [iframeKey, setIframeKey] = useState(0);

    // Force iframe refresh when project is updated (after edits)
    useEffect(() => {
        if (currentProject?.lastUpdated) {
            console.log('🔄 Project updated, refreshing iframe at:', new Date(currentProject.lastUpdated).toISOString());
            setIframeKey(prev => prev + 1);
            setIsLoading(true);
            setIframeError(false);
        }
    }, [currentProject?.lastUpdated]);

    if (!currentProject) {
        return (
            <ProjectList
                onProjectSelect={onProjectSelect || (() => {})}
                onNewProject={onNewProject || (() => {})}
            />
        );
    }

    // Prioritize vercelUrl over previewUrl over url
    const previewUrl = currentProject.vercelUrl || currentProject.previewUrl || currentProject.url;

    // If there's no deployment URL, show a message
    if (!previewUrl) {
        return (
            <div className="h-full flex flex-col bg-white overflow-y-auto">
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center max-w-md">
                        <div className="text-6xl mb-4">🚀</div>
                        <h3 className="text-xl font-semibold text-black mb-2">No Deployment Yet</h3>
                        <p className="text-sm text-black-60 mb-6">
                            This project hasn&apos;t been deployed yet. Use the chat to make changes and deploy your app.
                        </p>
                        <div className="bg-black-5 rounded-lg p-4 text-left">
                            <p className="text-xs text-black-60 font-medium mb-2">💡 Tip:</p>
                            <p className="text-xs text-black-60">
                                Ask the AI to &quot;deploy this project&quot; or make changes to trigger a deployment.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    console.log('🔍 Preview component - URLs:', {
        vercelUrl: currentProject.vercelUrl,
        previewUrl: currentProject.previewUrl,
        url: currentProject.url,
        selectedUrl: previewUrl
    });

    const handleIframeError = () => {
        console.error('Iframe failed to load:', previewUrl);
        setIframeError(true);
        setIsLoading(false);
    };

    const handleIframeLoad = () => {
        setIsLoading(false);
        setIframeError(false);
    };

    return (
        <div className="h-full flex flex-col bg-white overflow-y-auto">
            {/* Mobile Preview */}
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="relative flex flex-col items-center">
                    {/* iPhone frame */}
                    <div className="bg-black rounded-[40px] shadow-2xl p-2 border-4 border-gray-800 relative">
                        {isLoading && !iframeError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white rounded-[32px] z-10">
                                <div className="text-sm text-gray-600">Loading preview...</div>
                            </div>
                        )}
                        {iframeError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-[32px] z-10 p-4">
                                <div className="text-sm text-red-600 mb-2 text-center font-semibold">
                                    Preview blocked by deployment
                                </div>
                                <div className="text-xs text-gray-600 mb-1 text-center">
                                    The deployed app refused iframe embedding
                                </div>
                                <div className="text-xs text-gray-400 mb-4 text-center break-all px-2">
                                    {previewUrl}
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 max-w-[280px]">
                                    <p className="text-xs text-blue-800 mb-2">
                                        💡 <strong>Why this happens:</strong>
                                    </p>
                                    <p className="text-xs text-blue-700">
                                        Vercel deployments block iframe embedding for security. The app needs to be redeployed with updated security headers.
                                    </p>
                                </div>
                                <button
                                    onClick={() => window.open(previewUrl, '_blank')}
                                    className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 font-medium mb-2"
                                >
                                    Open in New Tab
                                </button>
                                <button
                                    onClick={() => {
                                        setIframeError(false);
                                        setIsLoading(true);
                                        setIframeKey(prev => prev + 1);
                                    }}
                                    className="px-3 py-1 text-gray-600 text-xs rounded hover:text-black"
                                >
                                    Retry
                                </button>
                            </div>
                        )}
                        <iframe
                            key={`${currentProject.projectId}-${iframeKey}`}
                            src={previewUrl}
                            className="w-full h-full rounded-[32px] border-0 bg-white"
                            title="Generated App Preview"
                            allow="fullscreen; camera; microphone; gyroscope; accelerometer; geolocation; clipboard-write; autoplay"
                            data-origin={previewUrl}
                            data-v0="true"
                            loading="eager"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups-to-escape-sandbox allow-pointer-lock allow-popups allow-modals allow-orientation-lock allow-presentation"
                            onError={handleIframeError}
                            onLoad={handleIframeLoad}
                            style={{
                                width: 320,
                                height: 600, // iPhone 12/13/14 aspect ratio
                                scrollbarWidth: 'none',
                                msOverflowStyle: 'none'
                            }}
                        />
                    </div>
                    <div className="mt-2 text-xs text-black-60">
                        Mobile Preview
                    </div>
                    {previewUrl && (
                        <div className="mt-1 text-xs text-gray-500 text-center max-w-xs truncate">
                            {previewUrl}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
} 