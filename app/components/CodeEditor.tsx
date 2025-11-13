'use client';
import { logger } from "../../lib/logger";


import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAuthContext } from '../contexts/AuthContext';

// Monaco Editor (dynamically loaded for SSR)
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { 
  ssr: false,
  loading: () => <div className="text-black-60 text-sm text-center flex-1 flex items-center justify-center">Loading editor...</div>
});

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

interface CodeEditorProps {
    currentProject: GeneratedProject | null;
    onFileChange?: (filePath: string, content: string) => void;
    onSaveFile?: (filePath: string, content: string) => Promise<boolean>;
}

// Important files to show in the file tree
const IMPORTANT_FILES = [
    'src/app/page.tsx',
    'src/app/layout.tsx',
    'src/app/providers.tsx',
    'src/app/globals.css',
    'src/components/ui/Button.tsx',
    'src/components/ui/Input.tsx',
    'src/components/wallet/ConnectWallet.tsx',
    'src/lib/utils.ts',
    'src/lib/wagmi.ts',
    'src/types/index.ts',
    'package.json',
    'tsconfig.json',
    'next.config.ts',
    'postcss.config.mjs',
    'eslint.config.mjs',
    'public/.well-known/farcaster.json'
];

// Files to exclude from display
const EXCLUDED_FILES = [
    'node_modules', '.git', '.next', 'dist', 'build',
    'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
    '.env', '.env.local', '.env.production',
    'README.md', '.gitignore'
];

// Fetch file content from the API
async function fetchFileContent(filePath: string, projectId?: string, sessionToken?: string): Promise<string> {
    if (projectId && sessionToken) {
        try {
            logger.log(`🌐 Fetching file from API: /api/files?file=${encodeURIComponent(filePath)}&projectId=${projectId}`);
            const response = await fetch(`/api/files?file=${encodeURIComponent(filePath)}&projectId=${projectId}`, {
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });
            logger.log(`📡 API response status: ${response.status} ${response.statusText}`);
            if (response.ok) {
                const content = await response.text();
                logger.log(`✅ File content received: ${content.length} characters`);
                return content;
            } else {
                logger.error(`❌ API error: ${response.status} ${response.statusText}`);
                const errorText = await response.text();
                logger.error(`❌ Error response: ${errorText}`);
            }
        } catch (error) {
            logger.error(`❌ Network error fetching file ${filePath}:`, error);
        }
    }
    return '// File not found or error loading content';
}

// Fetch project files from database
async function fetchProjectFilesFromDB(projectId: string, sessionToken?: string): Promise<string[]> {
    if (!sessionToken) return [];
    
    try {
        logger.log(`🔍 Fetching project files from database for project: ${projectId}`);
        const response = await fetch(`/api/projects/${projectId}`, {
            headers: { 'Authorization': `Bearer ${sessionToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const files = data.project?.files || [];
            return files.map((f: { filename: string }) => f.filename);
        } else {
            logger.error(`❌ HTTP error: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        logger.error('❌ Network error fetching project files from database:', error);
    }
    return [];
}

// Fetch file content from database
async function fetchFileContentFromDB(filePath: string, projectId: string, sessionToken: string): Promise<string> {
    try {
        logger.log(`🗄️ Fetching file from database: /api/projects/${projectId}`);
        const response = await fetch(`/api/projects/${projectId}`, {
            headers: { 'Authorization': `Bearer ${sessionToken}` }
        });

        logger.log(`📡 Database API response status: ${response.status} ${response.statusText}`);
        if (response.ok) {
            const data = await response.json();
            const files = data.project?.files || [];
            logger.log(`📁 Database files found: ${files.length} files`);
            const file = files.find((f: { filename: string; content: string }) => f.filename === filePath);
            if (file) {
                logger.log(`✅ File found in database: ${filePath} (${file.content.length} chars)`);
                return file.content;
            } else {
                logger.log(`❌ File not found in database: ${filePath}`);
            }
        } else {
            logger.error(`❌ Database API error: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            logger.error(`❌ Database error response: ${errorText}`);
        }
    } catch (error) {
        logger.error(`❌ Network error fetching file ${filePath} from database:`, error);
    }
    return '// File not found or error loading content';
}

// Fetch list of available files from the project
async function fetchProjectFiles(projectId: string, sessionToken?: string): Promise<string[]> {
    if (!sessionToken) return [];
    
    try {
        logger.log(`🔍 Fetching project files for project: ${projectId}`);
        const response = await fetch(`/api/files?projectId=${projectId}&listFiles=true`, {
            headers: { 'Authorization': `Bearer ${sessionToken}` }
        });

        if (response.ok) {
            const responseText = await response.text();
            if (!responseText.trim()) {
                logger.warn('⚠️ Empty response from server');
                return [];
            }

            try {
                const data = JSON.parse(responseText);
                return data.files || [];
            } catch (parseError) {
                logger.error('❌ JSON parsing failed:', parseError);
                return [];
            }
        } else {
            logger.error(`❌ HTTP error: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        logger.error('❌ Network error fetching project files:', error);
    }
    return [];
}

// Create hierarchical file tree structure
interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'folder';
    children?: FileNode[];
    isExpanded?: boolean;
}

function createFileTree(files: string[]): FileNode[] {
    const tree: FileNode[] = [];
    const fileMap = new Map<string, FileNode>();

    // Filter important files and create nodes
    const importantFiles = files.filter(file =>
        !EXCLUDED_FILES.some(excluded => file.includes(excluded)) &&
        (IMPORTANT_FILES.includes(file) || 
         file.startsWith('src/') || 
         file.startsWith('public/') ||
         file.endsWith('.json') ||
         file.endsWith('.ts') ||
         file.endsWith('.tsx') ||
         file.endsWith('.js') ||
         file.endsWith('.jsx') ||
         file.endsWith('.css') ||
         file.endsWith('.md'))
    );

    importantFiles.forEach(file => {
        const parts = file.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (!fileMap.has(currentPath)) {
                const node: FileNode = {
                    name: part,
                    path: currentPath,
                    type: isFile ? 'file' : 'folder',
                    children: [],
                    isExpanded: i < 2 // Expand first two levels by default
                };

                fileMap.set(currentPath, node);

                // Add to parent
                if (i > 0) {
                    const parentPath = parts.slice(0, i).join('/');
                    const parent = fileMap.get(parentPath);
                    if (parent) {
                        parent.children?.push(node);
                    }
                } else {
                    tree.push(node);
                }
            }
        }
    });

    return tree;
}

// File Tree View Component
interface FileTreeViewProps {
    nodes: FileNode[];
    selectedFile: string;
    onFileSelect: (filePath: string) => void;
}

function FileTreeView({ nodes, selectedFile, onFileSelect }: FileTreeViewProps) {
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

    const toggleFolder = (path: string) => {
        const newExpanded = new Set(expandedFolders);
        if (newExpanded.has(path)) {
            newExpanded.delete(path);
        } else {
            newExpanded.add(path);
        }
        setExpandedFolders(newExpanded);
    };

    const renderNode = (node: FileNode, level: number = 0) => {
        const isExpanded = expandedFolders.has(node.path);
        const isSelected = selectedFile === node.path;

        return (
            <div key={node.path}>
                <button
                    onClick={() => {
                        if (node.type === 'folder') {
                            toggleFolder(node.path);
                        } else {
                            onFileSelect(node.path);
                        }
                    }}
                    className={`w-full text-left px-2 py-1 rounded text-xs font-mono transition-colors ${isSelected
                        ? 'bg-black text-white'
                        : 'text-black hover:bg-black-10'
                        }`}
                    style={{ paddingLeft: `${level * 12 + 8}px` }}
                    title={node.path}
                >
                    <div className="flex items-center gap-2">
                        {node.type === 'folder' ? (
                            <svg
                                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        ) : (
                            <span>📄</span>
                        )}
                        <span className="truncate">{node.name}</span>
                    </div>
                </button>
                {node.type === 'folder' && isExpanded && node.children && (
                    <div className="ml-2">
                        {node.children.map(child => renderNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-1">
            {nodes.map(node => renderNode(node))}
        </div>
    );
}

export function CodeEditor({ currentProject, onFileChange }: CodeEditorProps) {
    const [selectedFile, setSelectedFile] = useState<string>('');
    const [fileContent, setFileContent] = useState<string>('');
    const [originalContent, setOriginalContent] = useState<string>('');
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
    const [monacoError, setMonacoError] = useState<boolean>(false);
    const monacoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [monacoRetryCount, setMonacoRetryCount] = useState<number>(0);
    const { sessionToken } = useAuthContext();
    const [isSaving, setIsSaving] = useState(false);
    const [isDeploying, setIsDeploying] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [deploymentStatus, setDeploymentStatus] = useState<string>('');

    // Global error handler for Monaco Editor
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            logger.log('🔍 Global error detected:', event.message, event.filename);
            if (event.message && (
                event.message.includes('monaco-editor') || 
                event.message.includes('Monaco') ||
                event.message.includes('Monaco initialization') ||
                event.filename?.includes('monaco-editor')
            )) {
                logger.error('❌ Monaco Editor error detected:', event.message);
                setMonacoError(true);
            }
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            logger.log('🔍 Unhandled promise rejection:', event.reason);
            if (event.reason && (
                event.reason.toString().includes('monaco-editor') ||
                event.reason.toString().includes('Monaco') ||
                event.reason.toString().includes('Monaco initialization')
            )) {
                logger.error('❌ Monaco Editor promise rejection:', event.reason);
                setMonacoError(true);
            }
        };

        // Also listen for script loading errors
        const handleScriptError = (event: Event) => {
            const target = event.target as HTMLScriptElement;
            if (target && target.src && target.src.includes('monaco-editor')) {
                logger.log('❌ Monaco Editor script loading error detected');
                setMonacoError(true);
            }
        };

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        document.addEventListener('error', handleScriptError, true);

        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            document.removeEventListener('error', handleScriptError, true);
        };
    }, []);

    // Reset Monaco error when file changes
    useEffect(() => {
        if (selectedFile) {
            logger.log('🔄 File changed, resetting Monaco error state');
            setMonacoError(false);
        }
    }, [selectedFile]);

    // Monaco Editor load timeout - if Monaco doesn't load within 15 seconds, show fallback
    useEffect(() => {
        // Clear any existing timeouts first
        if (monacoTimeoutRef.current) {
            clearTimeout(monacoTimeoutRef.current);
            monacoTimeoutRef.current = null;
        }

        if (selectedFile && fileContent && !monacoError) {
            logger.log('⏰ Starting Monaco load timeout for file:', selectedFile);
            
            // Timeout at 15 seconds - fallback
            monacoTimeoutRef.current = setTimeout(() => {
                logger.log('⏰ Monaco Editor load timeout (15s) - switching to fallback');
                logger.log('⏰ This means Monaco never called onMount()');
                setMonacoError(true);
            }, 15000); // 15 second timeout - give Monaco plenty of time

            return () => {
                if (monacoTimeoutRef.current) {
                    clearTimeout(monacoTimeoutRef.current);
                    monacoTimeoutRef.current = null;
                }
            };
        }
    }, [selectedFile, fileContent, monacoError]);

    // Debug logging for fallback editor
    useEffect(() => {
        if (monacoError && fileContent) {
            logger.log(`📝 Fallback editor active - fileContent length: ${fileContent?.length || 0}, content preview: ${fileContent?.substring(0, 100) || 'empty'}...`);
        }
    }, [monacoError, fileContent]);

    // Fetch project files when project is created
    useEffect(() => {
        if (currentProject && sessionToken) {
            logger.log(`🔍 Loading project files for project: ${currentProject.projectId}`);
            // Try database first, then fallback to file system
            fetchProjectFilesFromDB(currentProject.projectId, sessionToken).then(files => {
                logger.log(`📁 Database files found:`, files);
                if (files.length > 0) {
                    setFileTree(createFileTree(files));
                    // Set first available file as selected
                    const firstFile = files.find(f => f.includes('page.tsx')) || files[0];
                    logger.log(`📄 Setting first file as selected: ${firstFile}`);
                    setSelectedFile(firstFile);
                } else {
                    logger.log(`⚠️ No files found in database, trying file system for project: ${currentProject.projectId}`);
                    // Fallback to file system
                    fetchProjectFiles(currentProject.projectId, sessionToken).then(files => {
                        logger.log(`📁 File system files found:`, files);
                        setFileTree(createFileTree(files));
                        if (files.length > 0) {
                            const firstFile = files.find(f => f.includes('page.tsx')) || files[0];
                            logger.log(`📄 Setting first file as selected: ${firstFile}`);
                            setSelectedFile(firstFile);
                        }
                    });
                }
            });
        } else {
            logger.log(`⚠️ Missing requirements for file tree loading:`, {
                hasProject: !!currentProject,
                hasSessionToken: !!sessionToken
            });
        }
    }, [currentProject, sessionToken]);

    // Fetch file content when selected file changes
    useEffect(() => {
        if (currentProject && selectedFile && sessionToken) {
            logger.log(`🔍 Loading file content for: ${selectedFile} in project: ${currentProject.projectId}`);
            logger.log(`🌍 Environment: ${process.env.NODE_ENV} | URL: ${window.location.origin}`);
            logger.log(`🔑 Session token present: ${!!sessionToken}`);
            
            setIsLoadingContent(true);
            setFileContent(''); // Clear previous content
            
            // Set a timeout to prevent infinite loading
            const timeoutId = setTimeout(() => {
                logger.error(`⏰ Timeout loading file content for: ${selectedFile}`);
                setIsLoadingContent(false);
                setFileContent('// File loading timeout - please try again');
            }, 10000); // 10 second timeout
            
            // Try database first, then fallback to file system
            fetchFileContentFromDB(selectedFile, currentProject.projectId, sessionToken).then(content => {
                clearTimeout(timeoutId);
                logger.log(`📄 Database content for ${selectedFile}:`, content.substring(0, 100) + '...');
                if (content !== '// File not found or error loading content') {
                    logger.log(`✅ Setting file content from database: ${content.length} characters`);
                    setFileContent(content);
                    setOriginalContent(content);
                    setHasUnsavedChanges(false);
                    setIsLoadingContent(false); // Stop loading when content is successfully loaded
                } else {
                    logger.log(`⚠️ File not found in database, trying file system for: ${selectedFile}`);
                    // Fallback to file system
                    fetchFileContent(selectedFile, currentProject.projectId, sessionToken).then(fileSystemContent => {
                        logger.log(`📄 File system content for ${selectedFile}:`, fileSystemContent.substring(0, 100) + '...');
                        logger.log(`✅ Setting file content from file system: ${fileSystemContent.length} characters`);
                        setFileContent(fileSystemContent);
                        setIsLoadingContent(false);
                    });
                }
            }).catch(error => {
                clearTimeout(timeoutId);
                logger.error(`❌ Error loading file content:`, error);
                setFileContent('// Error loading file content');
                setIsLoadingContent(false);
            });
        } else {
            logger.log(`⚠️ Missing requirements for file loading:`, {
                hasProject: !!currentProject,
                hasSelectedFile: !!selectedFile,
                hasSessionToken: !!sessionToken
            });
            setIsLoadingContent(false);
        }
    }, [selectedFile, currentProject, sessionToken]);

    const handleFileChange = (value: string | undefined) => {
        if (value !== undefined && selectedFile) {
            setFileContent(value);
            setHasUnsavedChanges(value !== originalContent);
            onFileChange?.(selectedFile, value);
        }
    };

    const handleSaveFile = async () => {
        if (!selectedFile || !currentProject?.projectId) return;
        
        if (!sessionToken) {
            logger.error('❌ No session token available');
            alert('Authentication required. Please refresh the page and log in again.');
            return;
        }
        
        setIsSaving(true);
        try {
            const response = await fetch(`/api/projects/${currentProject.projectId}/files`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    filePath: selectedFile,
                    content: fileContent,
                    redeploy: false
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `Failed to save file: ${response.status}`);
            }

            setOriginalContent(fileContent);
            setHasUnsavedChanges(false);
            logger.log('✅ File saved successfully');
        } catch (error) {
            logger.error('❌ Error saving file:', error);
            const message = error instanceof Error ? error.message : 'Failed to save file';
            alert(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAndRedeploy = async () => {
        if (!selectedFile || !currentProject?.projectId) return;
        
        if (!sessionToken) {
            logger.error('❌ No session token available');
            alert('Authentication required. Please refresh the page and log in again.');
            return;
        }
        
        setIsDeploying(true);
        setDeploymentStatus('Saving file...');
        try {
            const response = await fetch(`/api/projects/${currentProject.projectId}/files`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    filePath: selectedFile,
                    content: fileContent,
                    redeploy: true
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to save and redeploy');
            }

            setOriginalContent(fileContent);
            setHasUnsavedChanges(false);
            setDeploymentStatus('✅ Deployed successfully!');
            logger.log('✅ File saved and redeployed:', data.deploymentUrl);
            
            // Clear status after 3 seconds
            setTimeout(() => setDeploymentStatus(''), 3000);
        } catch (error) {
            logger.error('❌ Error saving and redeploying:', error);
            const message = error instanceof Error ? error.message : 'Deployment failed';
            setDeploymentStatus(`❌ ${message}`);
            setTimeout(() => setDeploymentStatus(''), 5000);
        } finally {
            setIsDeploying(false);
        }
    };



    const getLanguage = (filename: string) => {
        if (filename.endsWith('.json')) return 'json';
        if (filename.endsWith('.css')) return 'css';
        if (filename.endsWith('.md')) return 'markdown';
        if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
        if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
        return 'typescript';
    };

    if (!currentProject) {
        return (
            <div className="h-full flex flex-col bg-white rounded-lg">
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-black-60 text-sm text-center">
                        Project files will appear here after generation.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="flex flex-1">
                {/* File Tree Sidebar */}
                <div className="w-64 border-r border-black-10 bg-black-5 p-4 overflow-y-auto">
                    <div className="text-xs font-semibold text-black mb-3">Project Files</div>
                    <FileTreeView
                        nodes={fileTree}
                        selectedFile={selectedFile}
                        onFileSelect={setSelectedFile}
                    />
                </div>
                {/* Editor */}
                <div className="flex-1 flex flex-col">
                    {/* Editor Header */}
                    <div className="flex items-center justify-between p-3 border-b border-black-10">
                        <div className="text-sm font-medium text-black">
                            {selectedFile ? selectedFile : 'Select a file'}
                            {hasUnsavedChanges && <span className="ml-2 text-xs text-orange-500">● Unsaved</span>}
                        </div>
                        {selectedFile && (
                            <div className="flex items-center gap-2">
                                {deploymentStatus && (
                                    <span className="text-xs text-gray-600">{deploymentStatus}</span>
                                )}
                                <button
                                    onClick={handleSaveFile}
                                    disabled={!hasUnsavedChanges || isSaving}
                                    className="text-xs px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {isSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    onClick={handleSaveAndRedeploy}
                                    disabled={isDeploying}
                                    className="text-xs px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    {isDeploying ? 'Deploying...' : 'Save & Redeploy'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Monaco Editor */}
                    <div className="flex-1">
                        {selectedFile ? (
                            <>
                                {logger.log(`🎨 Rendering Monaco editor for ${selectedFile} with content length: ${fileContent.length}, loading: ${isLoadingContent}`)}
                                {isLoadingContent ? (
                                    <div className="text-black-60 text-sm text-center flex-1 flex items-center justify-center">
                                        Loading file content...
                                    </div>
                                ) : fileContent && fileContent !== '// File not found or error loading content' && !fileContent.includes('timeout') && !fileContent.includes('Error loading') ? (
                                    !monacoError ? (
                                        <>
                                            {logger.log('🎯 Attempting to render Monaco Editor for:', selectedFile, 'monacoError:', monacoError)}
                                            <MonacoEditor
                                                height="100%"
                                                language={getLanguage(selectedFile)}
                                                value={fileContent}
                                                onChange={handleFileChange}
                                                loading={
                                                    <div className="flex items-center justify-center h-full">
                                                        <div className="text-sm text-gray-600">
                                                            Loading Monaco Editor...
                                                        </div>
                                                    </div>
                                                }
                                                onMount={(editor, monaco) => {
                                                    logger.log('✅ Monaco Editor mounted successfully!');
                                                    logger.log('✅ Editor instance:', !!editor);
                                                    logger.log('✅ Monaco instance:', !!monaco);
                                                    setMonacoError(false);
                                                    // Clear the timeout since Monaco loaded successfully
                                                    if (monacoTimeoutRef.current) {
                                                        logger.log('✅ Clearing Monaco timeout - editor loaded successfully');
                                                        clearTimeout(monacoTimeoutRef.current);
                                                        monacoTimeoutRef.current = null;
                                                    }
                                                }}
                                                onValidate={(markers) => {
                                                    logger.log('📊 Monaco validation markers:', markers.length);
                                                }}
                                            beforeMount={(monaco) => {
                                                try {
                                                    // Configure Monaco to work with CSP restrictions
                                                    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                                                        target: monaco.languages.typescript.ScriptTarget.ES2020,
                                                        allowNonTsExtensions: true,
                                                        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                                                        module: monaco.languages.typescript.ModuleKind.CommonJS,
                                                        noEmit: true,
                                                        esModuleInterop: true,
                                                        allowJs: true,
                                                        typeRoots: ["node_modules/@types"]
                                                    });
                                                } catch (error) {
                                                    logger.error('❌ Monaco Editor configuration error:', error);
                                                    setMonacoError(true);
                                                }
                                            }}
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 12,
                                                wordWrap: 'on',
                                                lineNumbers: 'on',
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                readOnly: false,
                                                theme: 'vs-light'
                                            }}
                                        />
                                        </>
                                    ) : (
                                        <div className="flex-1 flex flex-col">
                                            <div className="text-xs text-gray-500 p-2 border-b bg-blue-50 flex items-center justify-between">
                                                <span>📝 Text editor (Monaco loading failed)</span>
                                                {monacoRetryCount < 3 && (
                                                    <button
                                                        onClick={() => {
                                                            logger.log('🔄 Retrying Monaco Editor...');
                                                            setMonacoError(false);
                                                            setMonacoRetryCount(prev => prev + 1);
                                                        }}
                                                        className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                                                    >
                                                        Retry Monaco Editor
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex-1 relative">
                                                <textarea
                                                    value={fileContent || ''}
                                                    onChange={(e) => handleFileChange(e.target.value)}
                                                    className="w-full h-full p-4 font-mono text-sm border-0 resize-none focus:outline-none bg-white"
                                                    style={{ 
                                                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                                        lineHeight: '1.5',
                                                        tabSize: 2,
                                                        minHeight: '100%'
                                                    }}
                                                    readOnly={false}
                                                    spellCheck={false}
                                                    placeholder="File content will appear here..."
                                                />
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    <div className="text-black-60 text-sm text-center flex-1 flex items-center justify-center">
                                        {fileContent === '// File not found or error loading content' ? 'File not found' : 
                                         fileContent.includes('timeout') ? 'File loading timeout - please try again' :
                                         fileContent.includes('Error loading') ? 'Error loading file content' :
                                         'No content available'}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-black-60 text-sm text-center flex-1 flex items-center justify-center">
                                Select a file to edit
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
} 