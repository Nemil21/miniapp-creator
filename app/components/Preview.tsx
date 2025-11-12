'use client';
import { logger } from "../../lib/logger";

import { useState, useEffect } from 'react';
import { Icons } from './sections/icons';

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

interface PreviewProps {
    currentProject: GeneratedProject | null;
}

export function Preview({ currentProject }: PreviewProps) {
    const [iframeError, setIframeError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [iframeKey, setIframeKey] = useState(0);
    const [deploymentStatus, setDeploymentStatus] = useState<'checking' | 'ready' | 'building' | 'error'>('checking');
    const [retryCount, setRetryCount] = useState(0);

    // Check if deployment is ready before loading iframe
    useEffect(() => {
        if (!currentProject?.vercelUrl && !currentProject?.previewUrl) {
            setDeploymentStatus('ready');
            return;
        }

        const previewUrl = currentProject.vercelUrl || currentProject.previewUrl || currentProject.url;
        
        // Reset status when project changes
        setDeploymentStatus('checking');
        setRetryCount(0);

        const checkDeployment = async () => {
            try {
                logger.log(`🔍 Checking deployment readiness: ${previewUrl}`);
                
                // Try to fetch the deployment URL with a HEAD request
                await fetch(previewUrl, {
                    method: 'HEAD',
                    mode: 'no-cors', // Avoid CORS issues
                    cache: 'no-cache'
                });

                // With no-cors, we can't check the status, so assume it's ready if no error
                logger.log('✅ Deployment appears to be ready');
                setDeploymentStatus('ready');
            } catch (error) {
                logger.warn(`⚠️ Deployment check failed (attempt ${retryCount + 1}):`, error);
                
                // Retry up to 5 times with exponential backoff
                if (retryCount < 5) {
                    setDeploymentStatus('building');
                    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10s
                    logger.log(`⏳ Retrying in ${delay}ms...`);
                    
                    setTimeout(() => {
                        setRetryCount(prev => prev + 1);
                    }, delay);
                } else {
                    // After 5 attempts, assume it's ready and let the iframe try
                    // The iframe error handler will catch it if it's still not ready
                    logger.log('⏭️ Max retries reached, attempting to load anyway...');
                    setDeploymentStatus('ready');
                }
            }
        };

        checkDeployment();
    }, [currentProject?.vercelUrl, currentProject?.previewUrl, currentProject?.url, retryCount]);

    // Force iframe refresh when project is updated (after edits)
    useEffect(() => {
        if (currentProject?.lastUpdated) {
            logger.log('🔄 Project updated, refreshing iframe at:', new Date(currentProject.lastUpdated).toISOString());
            setIframeKey(prev => prev + 1);
            setIsLoading(true);
            setIframeError(false);
            setDeploymentStatus('checking');
            setRetryCount(0);
        }
    }, [currentProject?.lastUpdated]);

    if (!currentProject) {
        return (
            <div className="h-full flex flex-col bg-white overflow-y-auto">
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center max-w-md">
                        <div className="mb-6 flex justify-center">
                            <Icons.earnySmallGrayIcon className="w-16 h-16 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-semibold text-black mb-2">No Project Selected</h3>
                        <p className="text-sm text-black-60 mb-6">
                            Please Select a project or start a new project in the chat.
                        </p>
                        <div className="bg-black-5 rounded-lg p-4 text-left">
                            <p className="text-xs text-black-60 font-medium mb-2">💡 Tip:</p>
                            <p className="text-xs text-black-60">
                                Describe your mini app idea in the chat and Minidev will build it for you.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
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
                        <div className="mb-6 flex justify-center">
                            <Icons.earnySmallGrayIcon className="w-16 h-16 text-gray-400" />
                        </div>
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

    logger.log('🔍 Preview component - URLs:', {
        vercelUrl: currentProject.vercelUrl,
        previewUrl: currentProject.previewUrl,
        url: currentProject.url,
        selectedUrl: previewUrl
    });

    const handleIframeError = () => {
        logger.error('Iframe failed to load:', previewUrl);
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
                        {deploymentStatus === 'checking' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-[32px] z-10">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
                                <div className="text-sm text-gray-600">Checking deployment...</div>
                            </div>
                        )}
                        {deploymentStatus === 'building' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-[32px] z-10 p-4">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
                                <div className="text-sm font-semibold text-gray-900 mb-1">Deployment Building...</div>
                                <div className="text-xs text-gray-600 text-center mb-3">
                                    Your app is being deployed to Vercel. This usually takes 1-2 minutes.
                                </div>
                                <div className="text-xs text-gray-500">
                                    Attempt {retryCount + 1} of 5
                                </div>
                            </div>
                        )}
                        {isLoading && !iframeError && deploymentStatus === 'ready' && (
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
                                        setDeploymentStatus('checking');
                                        setRetryCount(0);
                                    }}
                                    className="px-3 py-1 text-gray-600 text-xs rounded hover:text-black"
                                >
                                    Retry
                                </button>
                            </div>
                        )}
                        {/* Only render iframe when deployment is ready */}
                        {deploymentStatus === 'ready' && (
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
                        )}
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