'use client';



import React, { useState, useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { Preview } from './Preview';
import { DevelopmentLogs } from './DevelopmentLogs';

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
    viewMode: 'code' | 'preview';
}

export function CodeEditorAndPreview({
    currentProject,
    isGenerating = false,
    onFileChange,
    onSaveFile,
    viewMode,
}: CodeEditorAndPreviewProps) {
    const [showLogs, setShowLogs] = useState(false);

    // Hide logs when generation completes
    useEffect(() => {
        if (!isGenerating && showLogs) {
            setShowLogs(false);
        }
    }, [isGenerating, showLogs]);

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
            {/* Content based on view mode */}
            <div className="flex-1 overflow-y-auto bg-gray-50">
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
            </div>

        </div>
    );
} 