'use client';

import React from 'react';
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
    isLoading?: boolean;
    onFileChange?: (filePath: string, content: string) => void;
    onSaveFile?: (filePath: string, content: string) => Promise<boolean>;
    viewMode: 'code' | 'preview';
}

export function CodeEditorAndPreview({
    currentProject,
    isGenerating = false,
    isLoading = false,
    onFileChange,
    onSaveFile,
    viewMode,
}: CodeEditorAndPreviewProps) {
    if (isGenerating) {
        return (
            <div className="h-full flex flex-col">
                <DevelopmentLogs onComplete={() => { /* no-op, generation completion handled upstream */ }} />
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-gray-50">
                <div className="flex flex-col items-center gap-4 text-gray-500">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
                    <p className="text-sm font-medium text-gray-600">Loading project…</p>
                </div>
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