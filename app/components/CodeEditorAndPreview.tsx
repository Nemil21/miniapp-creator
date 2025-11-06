'use client';
import { logger } from "../../lib/logger";


import { useState, useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { Preview } from './Preview';
import { DevelopmentLogs } from './DevelopmentLogs';
import { PublishModal } from './PublishModal';
import { PatchHistory } from './PatchHistory';

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

interface CodeEditorAndPreviewProps {
    currentProject: GeneratedProject | null;
    isGenerating?: boolean;
    onFileChange?: (filePath: string, content: string) => void;
    onSaveFile?: (filePath: string, content: string) => Promise<boolean>;
    onOpenSidebar?: () => void;
}

type ViewMode = 'code' | 'preview' | 'history';

export function CodeEditorAndPreview({
    currentProject,
    isGenerating = false,
    onFileChange,
    onSaveFile,

}: CodeEditorAndPreviewProps) {
    const [viewMode, setViewMode] = useState<ViewMode>(currentProject ? 'code' : 'preview');
    const [showLogs, setShowLogs] = useState(false);
    const [showPublishModal, setShowPublishModal] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    // Update view mode when currentProject changes
    useEffect(() => {
        if (currentProject) {
            setViewMode('preview'); // Show preview when project is loaded
        } else {
            setViewMode('preview'); // Show preview when no project
        }
    }, [currentProject]);

    // Hide logs when generation completes
    useEffect(() => {
        if (!isGenerating && showLogs) {
            setShowLogs(false);
        }
    }, [isGenerating, showLogs]);

    const getViewModeIcon = (mode: ViewMode) => {
        switch (mode) {
        case 'code':
            return (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
            );
        case 'preview':
            return (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
            );
        case 'history':
            return (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            );
        }
    };

    const getViewModeLabel = (mode: ViewMode) => {
        switch (mode) {
        case 'code':
            return 'Code';
        case 'preview':
            return 'Preview';
        case 'history':
            return 'History';
        }
    };

    const handleCopyUrl = async () => {
        if (!currentProject?.url) return;
        
        try {
            // Try modern clipboard API first
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(currentProject.url);
                setCopySuccess(true);
                setTimeout(() => setCopySuccess(false), 2000);
            } else {
                // Fallback for older browsers or non-secure contexts
                const textArea = document.createElement('textarea');
                textArea.value = currentProject.url;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (successful) {
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 2000);
                } else {
                    throw new Error('Copy command failed');
                }
            }
        } catch (error) {
            logger.error('Failed to copy URL:', error);
            // You could show a toast notification here if you have one
            alert('Failed to copy URL. Please copy manually: ' + currentProject.url);
        }
    };

    // Show development logs when generating
    if (isGenerating || showLogs) {
        return (
            <div className="h-full flex flex-col">
                <DevelopmentLogs
                    onComplete={() => {
                        // Only hide logs if generation is actually complete
                        // Don't trigger onComplete if isGenerating is still true
                        if (!isGenerating) {
                            setShowLogs(false);
                        }
                    }}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Header with toggle icons and project URL */}
            <div className="flex items-center justify-between p-4 border-b border-black-10 bg-white">
                {/* Left side - Toggle icons */}
                <div className="flex items-center gap-1 bg-black-5 rounded-lg p-1">
                    {(['code', 'preview'] as ViewMode[]).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setViewMode(mode)}
                            className={`p-2 rounded-md transition-colors ${viewMode === mode
                                ? 'bg-black text-white'
                                : 'text-black-60 hover:text-black hover:bg-black-10'
                                }`}
                            title={`${getViewModeLabel(mode)} view`}
                        >
                            {getViewModeIcon(mode)}
                        </button>
                    ))}
                    {/* History button commented out */}
                    {/* <button
                        onClick={() => setViewMode('history')}
                        className={`p-2 rounded-md transition-colors ${viewMode === 'history'
                            ? 'bg-black text-white'
                            : 'text-black-60 hover:text-black hover:bg-black-10'
                            }`}
                        title="History view"
                        disabled={!currentProject}
                    >
                        {getViewModeIcon('history')}
                    </button> */}
                </div>

                {/* Right side - Project URL controls */}
                <div className="flex items-center gap-3">
                    {currentProject && (
                        <>
                            <div className="flex flex-col">
                                <div className="text-xs text-black-60 font-medium">Project URL</div>
                                <button 
                                    onClick={() => window.open(currentProject.url, '_blank')}
                                    className="text-xs text-black font-mono max-w-[300px] truncate text-left hover:text-blue-600 transition-colors" 
                                    title={`Click to open: ${currentProject.url}`}
                                >
                                    {currentProject.url}
                                </button>
                            </div>
                            <button
                                onClick={handleCopyUrl}
                                className={`p-2 rounded transition-colors ${
                                    copySuccess 
                                        ? 'bg-green-600 text-white' 
                                        : 'bg-black text-white hover:bg-black-80'
                                }`}
                                title={copySuccess ? "Copied!" : "Copy URL"}
                            >
                                {copySuccess ? (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={() => window.open(currentProject.url, '_blank')}
                                className="p-2 bg-black-20 text-black rounded hover:bg-black-30 transition-colors"
                                title="Open in new tab"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                            </button>
                            <button
                                onClick={() => setShowPublishModal(true)}
                                className="px-3 py-2 bg-black text-white rounded hover:bg-black-80 transition-colors text-sm font-medium cursor-pointer"
                                title="Publish to Farcaster"
                            >
                                Publish
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Content based on view mode */}
            <div className="flex-1 overflow-y-auto">
                {/* Always render CodeEditor but hide when not in code mode */}
                <div className={`h-full ${viewMode === 'code' ? 'block' : 'hidden'}`}>
                    <CodeEditor
                        currentProject={currentProject}
                        onFileChange={onFileChange}
                        onSaveFile={onSaveFile}
                    />
                </div>

                {/* Always render Preview but hide when not in preview mode */}
                <div className={`h-full ${viewMode === 'preview' ? 'block' : 'hidden'}`}>
                    <Preview
                        currentProject={currentProject}
                    />
                </div>

                {/* Render PatchHistory when in history mode */}
                <div className={`h-full ${viewMode === 'history' ? 'block' : 'hidden'}`}>
                    {currentProject && (
                        <PatchHistory projectId={currentProject.projectId} />
                    )}
                </div>
            </div>

            {/* Publish Modal */}
            <PublishModal
                isOpen={showPublishModal}
                onClose={() => setShowPublishModal(false)}
                projectUrl={currentProject?.url}
                projectId={currentProject?.projectId}
            />
        </div>
    );
} 