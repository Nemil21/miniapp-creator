'use client';

import { logger } from "../../lib/logger";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuthContext } from '../contexts/AuthContext';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import type { EarnKit } from '@earnkit/earn';
import { toast } from 'react-hot-toast';
import { TextShimmer } from "./text-shimmer";
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
    lastUpdated?: number; // Timestamp to trigger iframe refresh after edits
    appType?: 'farcaster' | 'web3'; // Which boilerplate was used
}

interface ChatMessage {
    role: 'user' | 'ai';
    content: string;
    changedFiles?: string[];
    timestamp?: number;
    phase?: 'requirements' | 'building' | 'editing';
}

interface ChatInterfaceProps {
    currentProject: GeneratedProject | null;
    onProjectGenerated: (project: GeneratedProject | null) => void;
    onGeneratingChange: (isGenerating: boolean) => void;
    activeAgent?: EarnKit;
    initialAppType?: 'farcaster' | 'web3';
}

export interface ChatInterfaceRef {
    clearChat: () => void;
    focusInput: () => void;
    setAppType: (appType: 'farcaster' | 'web3') => void;
}

export const ChatInterface = forwardRef<ChatInterfaceRef, ChatInterfaceProps>(
    function ChatInterface({ currentProject, onProjectGenerated, onGeneratingChange, activeAgent, initialAppType = 'farcaster' }, ref) {
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    // const [error, setError] = useState<string | null>(null);
    const [chat, setChat] = useState<ChatMessage[]>([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [hasShownWarning, setHasShownWarning] = useState(false);
    const [appType, setAppType] = useState<'farcaster' | 'web3'>(initialAppType);
    const chatBottomRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const { sessionToken, user } = useAuthContext();
    const { ready: privyReady, authenticated } = usePrivy();
    const { wallets } = useWallets();
    const queryClient = useQueryClient();
    const walletAddress = wallets[0]?.address;

    // Check user's credit balance
    const { data: balance } = useQuery({
        queryKey: ["balance", "credit-based", walletAddress],
        queryFn: async () => {
            if (!walletAddress || !activeAgent) throw new Error("Wallet not connected");
            return activeAgent.getBalance({ walletAddress });
        },
        enabled: !!walletAddress && !!activeAgent && privyReady && authenticated,
        placeholderData: { eth: "0", credits: "0" },
        staleTime: 1000 * 30,
    });

    // Check if credits are disabled via environment variable
    const credsOff = process.env.NEXT_PUBLIC_CREDS_OFF === 'true';
    
    // Check if user has enough credits (need 1 credit per message)
    const hasEnoughCredits = balance ? parseInt(balance.credits) >= 1 : true; // Default to true if no activeAgent
    const shouldBlockChat = !credsOff && !!(activeAgent && walletAddress && !hasEnoughCredits);

    // Timeout ref for cleanup to prevent duplicate calls
    const generationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    // Flag to prevent chat state overwrites during message sending
    const isSendingMessageRef = useRef(false);

    // Sync appType state with currentProject.appType when a project is loaded or initialAppType changes
    useEffect(() => {
        if (currentProject?.appType) {
            logger.log(`🔄 Syncing appType from loaded project: ${currentProject.appType}`);
            setAppType(currentProject.appType);
        } else {
            // Use initialAppType when no project is loaded
            setAppType(initialAppType);
        }
    }, [currentProject?.appType, initialAppType]);

    // Chat session state - persist chatSessionId in sessionStorage to survive re-mounts
    const [chatSessionId] = useState<string>(() => {
        try {
            const stored = sessionStorage.getItem('minidev_chat_session_id');
            if (stored) return stored;
            const newId = crypto.randomUUID();
            sessionStorage.setItem('minidev_chat_session_id', newId);
            return newId;
        } catch {
            return crypto.randomUUID();
        }
    });
    const [chatProjectId, setChatProjectId] = useState<string>(''); // Track the actual project ID where chat messages are stored
    const [currentPhase, setCurrentPhase] = useState<'requirements' | 'building' | 'editing'>('requirements');

    // Function to scroll to bottom of chat
    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    };

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
        clearChat: () => {
            setChat([]);
            setPrompt('');
            setCurrentPhase('requirements');
            setChatProjectId('');
            // Clear session storage
            try {
                sessionStorage.removeItem('minidev_chat_session_id');
            } catch (e) {
                logger.error('Failed to clear session storage:', e);
            }
        },
        focusInput: () => {
            if (textareaRef.current) {
                textareaRef.current.focus();
            }
        },
        setAppType: (newAppType: 'farcaster' | 'web3') => {
            setAppType(newAppType);
        }
    }));
    
    // Load chat messages when project changes
    useEffect(() => {
        const loadChatMessages = async () => {
            logger.log('🔍 ChatInterface useEffect triggered:', {
                currentProject: currentProject?.projectId,
                sessionToken: !!sessionToken,
                currentPhase,
                isSendingMessage: isSendingMessageRef.current,
                timestamp: new Date().toISOString()
            });

            // Skip loading if we're currently sending a message to prevent state overwrites
            if (isSendingMessageRef.current) {
                logger.log('⏭️ Skipping chat load - message sending in progress');
                return;
            }

            if (currentProject?.projectId && sessionToken) {
                // Set phase to 'editing' when an existing project is loaded
                if (currentPhase !== 'editing') {
                    logger.log('🔍 Setting phase to editing for existing project:', currentProject.projectId);
                    setCurrentPhase('editing');
                } else {
                    logger.log('🔍 Phase already set to editing, skipping');
                }

                try {
                    // Use the main chat API to get messages for this project
                    const response = await fetch(`/api/chat?projectId=${currentProject.projectId}`, {
                        headers: { 'Authorization': `Bearer ${sessionToken}` }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        if (data.messages && data.messages.length > 0) {
                            const loadedMessages: ChatMessage[] = data.messages.map((msg: { role: string; content: string; phase?: string; timestamp: number; changedFiles?: string[] }) => ({
                                role: msg.role,
                                content: msg.content,
                                phase: msg.phase,
                                timestamp: msg.timestamp,
                                changedFiles: msg.changedFiles
                            }));
                            setChat(loadedMessages);
                            return;
                        }
                    }
                } catch (error) {
                    logger.warn('Failed to load chat messages:', error);
                }
            } else if (!currentProject && currentPhase === 'editing') {
                // Only reset phase if we're in editing mode and project is cleared
                // Don't reset during building phase to avoid interrupting generation
                logger.log('🔄 Project cleared, resetting phase to requirements');
                setCurrentPhase('requirements');
            }

            // Add welcome message when no project or no messages
            if (chat.length === 0 && !aiLoading) {
                setChat([{
                    role: 'ai',
                    content: getWelcomeMessage(appType),
                    phase: 'requirements',
                    timestamp: Date.now()
                }]);
            }
        };

        loadChatMessages();
        // REMOVED currentPhase from dependencies to prevent reset loop during generation
    }, [currentProject, sessionToken, chat.length, aiLoading, currentPhase, appType]);

    // Helper function to get welcome message based on app type
    const getWelcomeMessage = (type: 'farcaster' | 'web3') => {
        if (type === 'web3') {
            return 'Minidev is your on-chain sidekick that transforms ideas into fully functional Web3 Web Apps — no coding required.';
        }
        return 'Minidev is your on-chain sidekick that transforms ideas into fully functional Farcaster Mini Apps — no coding required.';
    };

    // Helper function to get Minidev pfp based on app type
    const getMinidevPfp = (type: 'farcaster' | 'web3') => {
        if (type === 'web3') {
            return '/minidevpfpweb.png';
        }
        return '/minidevpfpfarcaster.jpeg';
    };

    // Update welcome message when app type changes
    useEffect(() => {
        // Only update if we have exactly one message (the welcome message) and no project
        // Don't use chat in the condition check to avoid race conditions
        setChat(prev => {
            // Only update if it's just the welcome message
            if (prev.length === 1 && !currentProject && prev[0].role === 'ai' && prev[0].phase === 'requirements') {
                logger.log(`🔄 App type changed to ${appType}, updating welcome message`);
                return [{
                    role: 'ai',
                    content: getWelcomeMessage(appType),
                    phase: 'requirements',
                    timestamp: Date.now()
                }];
            }
            return prev;
        });
    }, [appType, currentProject]);

    // Show warning message once when user hasn't started chatting
    useEffect(() => {
        if (chat.length === 1 && !hasShownWarning && !aiLoading) {
            setHasShownWarning(true);
        }
    }, [chat.length, hasShownWarning, aiLoading]);

    // Scroll to bottom when chat messages change
    useEffect(() => {
        scrollToBottom();
    }, [chat, aiLoading]);

    // Add aiLoading timeout to prevent infinite loading
    useEffect(() => {
        if (aiLoading) {
            const timeout = setTimeout(() => {
                logger.log('⏰ AI response timeout after 30 seconds');
                setAiLoading(false);
            }, 30000); // 30 second timeout for chat responses
            
            return () => clearTimeout(timeout);
        }
    }, [aiLoading]);

    // Notify parent when generating state changes
    useEffect(() => {
        logger.log('🔄 onGeneratingChange called with isGenerating:', isGenerating);
        onGeneratingChange(isGenerating);
    }, [isGenerating, onGeneratingChange]);


    // Cleanup timeout on unmount to prevent memory leaks and duplicate calls
    useEffect(() => {
        return () => {
            if (generationTimeoutRef.current) {
                logger.log('🧹 Cleaning up generation timeout on unmount');
                clearTimeout(generationTimeoutRef.current);
                generationTimeoutRef.current = null;
            }
        };
    }, []);

    const handleSendMessage = async (userMessage: string) => {
        if (!chatSessionId || !sessionToken) return;
        
        // Check credits BEFORE starting any UI updates
        if (shouldBlockChat) {
            toast.error('Insufficient credits. Please top up your balance to continue chatting.');
            return;
        }
        
        // Set flag to prevent chat state overwrites during message sending
        isSendingMessageRef.current = true;
        
        setPrompt(''); // Clear input immediately
        setAiLoading(true);


        // setError(null);

        // Add user message immediately
        const userMsg: ChatMessage = {
            role: 'user',
            content: userMessage,
            phase: currentPhase,
            timestamp: Date.now()
        };
        
        // Save to state immediately
        setChat(prev => [...prev, userMsg]);

        // Save user message to database immediately if we have a project
        // This prevents race conditions where messages disappear
        if (currentProject?.projectId) {
            try {
                await fetch(`/api/projects/${currentProject.projectId}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                    body: JSON.stringify({
                        role: 'user',
                        content: userMessage,
                        phase: currentPhase
                    })
                });
                logger.log('💾 User message saved to database (initial save)');
            } catch (error) {
                logger.error('❌ Failed to save user message to database:', error);
            }
        }

        // Credit tracking - handled entirely server-side to prevent double charging
        // Previously, both client and server were tracking credits, causing double charges
        const walletAddress = wallets[0]?.address;

        try {
            // Credit validation and tracking is now done server-side only in /api/chat
            // This fixes the bug where users were charged 2x per message
            const endpoint = '/api/chat';
            const body: {
                sessionId: string;
                message: string;
                stream: boolean;
                action?: string;
                projectId?: string;
                walletAddress?: string;
            } = {
                sessionId: chatSessionId,
                message: userMessage,
                stream: false,
                projectId: currentProject?.projectId,
                walletAddress: walletAddress // Send wallet address for server-side validation
            };

            // Determine the appropriate action based on current phase
            if (currentPhase === 'requirements') {
                body.action = 'requirements_gathering';
            } else if (currentPhase === 'building') {
                body.action = 'confirm_project';
            } else {
                // For editing phase, directly apply changes without streaming conversation
                logger.log('🔄 Directly applying changes to existing project...');

                try {
                    // Save user message to database first
                    if (currentProject?.projectId) {
                        try {
                            await fetch(`/api/projects/${currentProject.projectId}/chat`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                                body: JSON.stringify({
                                    role: 'user',
                                    content: userMessage,
                                    phase: 'editing'
                                })
                            });
                            logger.log('💾 User message saved to database');
                        } catch (error) {
                            logger.warn('Failed to save user message to database:', error);
                        }
                    }

                    // Add processing message
                    const processingMessage = {
                        role: 'ai' as const,
                        content: 'Processing your request and updating the project...',
                        phase: 'editing' as const,
                        timestamp: Date.now()
                    };
                    setChat(prev => [...prev, processingMessage]);

                    // Use async job polling for edits (like initial generation)
                    const updateResponse = await fetch('/api/generate', {
                        method: 'PATCH',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'Authorization': `Bearer ${sessionToken}`,
                            'X-Use-Async-Processing': 'true' // Enable async mode for background processing
                        },
                        body: JSON.stringify({
                            projectId: currentProject?.projectId,
                            prompt: userMessage,
                            stream: false
                        }),
                    });

                    // Check if async job was created (202 Accepted)
                    if (updateResponse.status === 202) {
                        const jobData = await updateResponse.json();
                        logger.log('🔄 Async edit job created:', jobData.jobId);

                        // Update processing message to show polling
                        setChat(prev => {
                            const newChat = [...prev];
                            if (newChat.length > 0 && newChat[newChat.length - 1].role === 'ai') {
                                newChat[newChat.length - 1].content = `Processing your changes... This may take 2-5 minutes. Job ID: ${jobData.jobId.substring(0, 8)}...`;
                            }
                            return newChat;
                        });

                        // Poll for job completion
                        const result = await pollJobStatus(jobData.jobId);
                        logger.log('✅ Edit job completed:', result);

                        // Update project with new URLs and timestamp to trigger iframe refresh
                        if (currentProject) {
                            const updatedProject: GeneratedProject = {
                                ...currentProject,
                                previewUrl: result.previewUrl || currentProject.previewUrl,
                                vercelUrl: result.vercelUrl || currentProject.vercelUrl,
                                url: result.previewUrl || result.vercelUrl || currentProject.url,
                                lastUpdated: Date.now(), // Add timestamp to force iframe refresh
                            };
                            logger.log('🔄 Updating project with timestamp:', updatedProject.lastUpdated);
                            onProjectGenerated(updatedProject);
                        }

                        // Show success message with actual file count
                        const changedFiles = result.generatedFiles || [];
                        const successContent = `Changes applied successfully! I've updated ${changedFiles.length} files. The preview should reflect your changes shortly.`;
                        
                        setChat(prev => {
                            const newChat = [...prev];
                            if (newChat.length > 0 && newChat[newChat.length - 1].role === 'ai') {
                                newChat[newChat.length - 1].content = successContent;
                                newChat[newChat.length - 1].changedFiles = changedFiles;
                            }
                            return newChat;
                        });

                        // Credit capture is handled server-side to prevent double charging
                        // Invalidate balance query to refresh balance display
                        queryClient.invalidateQueries({ queryKey: ["balance"] });

                        // Save AI success message to database
                        if (currentProject?.projectId) {
                            try {
                                await fetch(`/api/projects/${currentProject.projectId}/chat`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                                    body: JSON.stringify({
                                        role: 'ai',
                                        content: successContent,
                                        phase: 'editing',
                                        changedFiles: changedFiles
                                    })
                                });
                                logger.log('💾 AI success message saved to database');
                            } catch (error) {
                                logger.warn('Failed to save AI message to database:', error);
                            }
                        }
                    } else if (updateResponse.ok) {
                        // Fallback: synchronous response (shouldn't happen with async mode)
                        const updateData = await updateResponse.json();
                        logger.log('✅ Changes applied successfully (sync mode):', updateData.changed);

                        // Update currentProject with new preview URL and timestamp to refresh iframe
                        if (currentProject) {
                            const updatedProject: GeneratedProject = {
                                ...currentProject,
                                previewUrl: updateData.previewUrl || currentProject.previewUrl,
                                vercelUrl: updateData.vercelUrl || currentProject.vercelUrl,
                                url: updateData.previewUrl || updateData.vercelUrl || currentProject.url,
                                lastUpdated: Date.now(), // Add timestamp to force iframe refresh
                            };
                            logger.log('🔄 Updating project with timestamp:', updatedProject.lastUpdated);
                            onProjectGenerated(updatedProject);
                        }

                        // Prepare success message
                        const successContent = `Changes applied successfully! I've updated ${updateData.changed?.length || 0} files. The preview should reflect your changes shortly.`;
                        
                        // Update the last AI message with success
                        setChat(prev => {
                            const newChat = [...prev];
                            if (newChat.length > 0 && newChat[newChat.length - 1].role === 'ai') {
                                newChat[newChat.length - 1].content = successContent;
                                newChat[newChat.length - 1].changedFiles = updateData.changed || [];
                            }
                            return newChat;
                        });

                        // Credit capture is handled server-side to prevent double charging
                        // Invalidate balance query to refresh balance display
                        queryClient.invalidateQueries({ queryKey: ["balance"] });

                        // Save AI success message to database
                        if (currentProject?.projectId) {
                            try {
                                await fetch(`/api/projects/${currentProject.projectId}/chat`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                                    body: JSON.stringify({
                                        role: 'ai',
                                        content: successContent,
                                        phase: 'editing',
                                        changedFiles: updateData.changed || []
                                    })
                                });
                                logger.log('💾 AI success message saved to database');
                            } catch (error) {
                                logger.warn('Failed to save AI message to database:', error);
                            }
                        }
                    } else {
                        const errorData = await updateResponse.json();
                        throw new Error(errorData.error || 'Failed to apply changes');
                    }
                } catch (updateError) {
                    logger.error('Failed to apply changes:', updateError);

                    const errorContent = '❌ Sorry, I encountered an error while applying the changes. Please try again.';
                    
                    // Update the last AI message with error
                    setChat(prev => {
                        const newChat = [...prev];
                        if (newChat.length > 0 && newChat[newChat.length - 1].role === 'ai') {
                            newChat[newChat.length - 1].content = errorContent;
                        }
                        return newChat;
                    });

                    // Save error message to database
                    if (currentProject?.projectId) {
                        try {
                            await fetch(`/api/projects/${currentProject.projectId}/chat`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                                body: JSON.stringify({
                                    role: 'ai',
                                    content: errorContent,
                                    phase: 'editing'
                                })
                            });
                            logger.log('💾 AI error message saved to database');
                        } catch (error) {
                            logger.warn('Failed to save AI error message to database:', error);
                        }
                    }
                } finally {
                    // IMPORTANT: Reset aiLoading before early return
                    setAiLoading(false);
                    setPrompt('');
                    // Clear the sending flag
                    isSendingMessageRef.current = false;
                }

                return; // Skip the rest of the function since we handled the editing phase
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to process message');
            }

            // Handle non-streaming response for requirements/building phases
            const data = await response.json();
            const aiResponse = data.response;
            
            // Track the project ID where chat messages are stored
            if (data.projectId && !chatProjectId) {
                setChatProjectId(data.projectId);
                logger.log('📝 Chat messages stored in project:', data.projectId);
            }

            // Credit capture is handled server-side to prevent double charging
            // Invalidate balance query to refresh balance display
            queryClient.invalidateQueries({ queryKey: ["balance"] });

            // Add AI message to chat
            const aiMsg: ChatMessage = {
                role: 'ai',
                content: aiResponse,
                phase: currentPhase,
                timestamp: Date.now()
            };
            
            // Save to state first
            setChat(prev => [...prev, aiMsg]);

            // Save AI message to database immediately to prevent race conditions
            // The chat API might have already saved it, but we save again to be sure
            const projectIdToSave = data.projectId || chatProjectId || currentProject?.projectId;
            if (projectIdToSave) {
                try {
                    await fetch(`/api/projects/${projectIdToSave}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                        body: JSON.stringify({
                            role: 'ai',
                            content: aiResponse,
                            phase: currentPhase
                        })
                    });
                    logger.log('💾 AI message saved to database');
                } catch (error) {
                    logger.error('❌ Failed to save AI message to database:', error);
                }
            }

            // Check if we should transition to building phase
            // Only allow generation in requirements phase
            if (currentPhase === 'requirements' && !isGenerating) {
                const aiResponseLower = aiResponse.toLowerCase();
                const isConfirmedByText = aiResponseLower.includes('proceed to build') ||
                    aiResponseLower.includes('building your miniapp') ||
                    aiResponseLower.includes('creating all the necessary files') ||
                    aiResponseLower.includes('perfect! i\'ll now proceed') ||
                    aiResponseLower.includes('proceeding to build');

                const isConfirmedByAPI = data.projectConfirmed === true;

                if (isConfirmedByText || isConfirmedByAPI) {
                    logger.log('✅ Project confirmation detected! Transitioning to building phase...', {
                        isConfirmedByText,
                        isConfirmedByAPI,
                        isGenerating,
                        existingTimeout: !!generationTimeoutRef.current
                    });
                    setCurrentPhase('building');

                    // Use the AI's analysis as the final prompt
                    const finalPrompt = aiResponse;

                    logger.log('🚀 Triggering project generation with AI analysis:', finalPrompt.substring(0, 200) + '...');

                    // Clear any existing timeout before scheduling a new one to prevent duplicates
                    if (generationTimeoutRef.current) {
                        clearTimeout(generationTimeoutRef.current);
                        logger.log('🧹 Cleared existing generation timeout to prevent duplicates');
                    }

                    // Store timeout reference for cleanup
                    generationTimeoutRef.current = setTimeout(() => {
                        logger.log('⏰ Timeout fired, calling handleGenerateProject');
                        handleGenerateProject(aiResponse);
                        generationTimeoutRef.current = null; // Clear ref after execution
                    }, 1000);
                    logger.log('⏰ Generation timeout scheduled for 1 second');
                }
            } else {
                // Log why generation is not allowed
                const phase = currentPhase as 'requirements' | 'building' | 'editing';
                if (phase === 'editing') {
                    logger.log('📝 In editing phase - generation not allowed, only file modifications');
                }
            }
        } catch (err) {
            logger.error('Error:', err);
            
            // Credits are only captured server-side on successful completion
            // If the call fails, server won't capture the tracked credits
            
            // setError(err instanceof Error ? err.message : 'An error occurred');
            const errorMsg: ChatMessage = {
                role: 'ai',
                content: 'Sorry, I encountered an error. Please try again.',
                phase: currentPhase,
                timestamp: Date.now()
            };
            
            setChat(prev => [...prev, errorMsg]);
            
            // Save error message to database too
            const projectIdToSave = chatProjectId || currentProject?.projectId;
            if (projectIdToSave) {
                try {
                    await fetch(`/api/projects/${projectIdToSave}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                        body: JSON.stringify({
                            role: 'ai',
                            content: errorMsg.content,
                            phase: currentPhase
                        })
                    });
                    logger.log('💾 Error message saved to database');
                } catch (saveError) {
                    logger.error('❌ Failed to save error message to database:', saveError);
                }
            }
        } finally {
            setAiLoading(false);
            setPrompt('');
            // Clear the sending flag
            isSendingMessageRef.current = false;
        }
    };

    // Polling function for async job status
    const pollJobStatus = async (jobId: string): Promise<GeneratedProject> => {
        const maxAttempts = 80; // Poll for up to ~20 minutes (80 * 15 seconds)
        let attempt = 0;

        logger.log(`🔄 Starting to poll job ${jobId}...`);

        return new Promise((resolve, reject) => {
            const pollInterval = setInterval(async () => {
                attempt++;

                try {
                    logger.log(`🔄 Polling job ${jobId} (attempt ${attempt}/${maxAttempts})...`);

                    const response = await fetch(`/api/jobs/${jobId}`, {
                        headers: {
                            'Authorization': `Bearer ${sessionToken}`,
                        },
                    });

                    if (!response.ok) {
                        clearInterval(pollInterval);
                        reject(new Error(`Failed to fetch job status: ${response.status}`));
                        return;
                    }

                    const job = await response.json();
                    logger.log(`📊 Job status:`, job.status);

                    if (job.status === 'completed') {
                        clearInterval(pollInterval);
                        logger.log('✅ Job completed successfully!', job.result);

                        // Transform job result to GeneratedProject format
                        const project: GeneratedProject = {
                            projectId: job.result.projectId,
                            port: job.result.port,
                            url: job.result.url,
                            generatedFiles: job.result.generatedFiles,
                            previewUrl: job.result.previewUrl,
                            vercelUrl: job.result.vercelUrl,
                            appType: job.result.appType || appType, // Include appType from job result
                            isNewDeployment: true, // Mark as new deployment for delay logic
                        };

                        resolve(project);
                    } else if (job.status === 'failed') {
                        clearInterval(pollInterval);
                        logger.log('❌ Job failed, details:', {
                            error: job.error,
                            result: job.result,
                            hasDeploymentError: job.result?.deploymentError,
                            deploymentError: job.result?.deploymentError
                        });
                        
                        // Try to extract detailed error message from result
                        const errorMessage = job.result?.deploymentError || job.error || 'Job failed';
                        reject(new Error(errorMessage));
                    } else if (attempt >= maxAttempts) {
                        clearInterval(pollInterval);
                        reject(new Error('Job polling timeout - generation is taking too long'));
                    }
                    // Otherwise, job is still pending or processing, continue polling
                } catch (error) {
                    logger.error('❌ Error polling job:', error);
                    clearInterval(pollInterval);
                    reject(error);
                }
            }, 15000); // Poll every 15 seconds
        });
    };

    const handleGenerateProject = async (generationPrompt: string) => {
        logger.log('🔍 handleGenerateProject called:', {
            hasPrompt: !!generationPrompt.trim(),
            hasSessionToken: !!sessionToken,
            isGenerating,
            currentPhase,
            timestamp: new Date().toISOString()
        });

        // Check if generation should proceed
        if (!generationPrompt.trim() || !sessionToken || isGenerating) {
            logger.log('⚠️ Skipping project generation:', {
                reason: !generationPrompt.trim() ? 'no prompt' :
                        !sessionToken ? 'no session token' :
                        isGenerating ? 'already generating' : 'unknown'
            });
            return;
        }

        logger.log('🚀 Starting project generation...');
        setIsGenerating(true);

        // setError(null);
        try {
            logger.log('🚀 Generating project with prompt:', generationPrompt.substring(0, 200) + '...');

            // Check if async processing is enabled
            const useAsyncProcessing = window.localStorage.getItem('minidev_use_async_processing') === 'true' ||
                                       process.env.NEXT_PUBLIC_USE_ASYNC_PROCESSING === 'true';

            // TEST MODE: Add this header to enable quick 30-second return for debugging
            const testQuickReturn = window.localStorage.getItem('minidev_test_quick_return') === 'true';
            if (testQuickReturn) {
                logger.log('🧪 TEST MODE ENABLED: API will return after 30 seconds');
            }

            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`,
                    ...(testQuickReturn && { 'X-Test-Quick-Return': 'true' }),
                    ...(useAsyncProcessing && { 'X-Use-Async-Processing': 'true' })
                },
                body: JSON.stringify({
                    prompt: generationPrompt,
                    projectId: chatProjectId || undefined,  // Pass existing project ID for chat preservation
                    appType: appType  // Pass selected app type to use correct boilerplate
                }),
            });

            logger.log('📤 Sent /api/generate request with:', {
                hasChatProjectId: !!chatProjectId,
                chatProjectId,
                useAsyncProcessing
            });

            // Handle async processing response (202 Accepted)
            if (response.status === 202 && useAsyncProcessing) {
                const jobData = await response.json();
                logger.log('🔄 Async job created:', jobData.jobId);

                // Add a message about async processing
                setChat(prev => [
                    ...prev,
                    {
                        role: 'ai',
                        content: `⏳ Your miniapp generation has started! This will take about ${jobData.estimatedTime || '5-10 minutes'}. I'll let you know when it's ready.`,
                        phase: 'building',
                        timestamp: Date.now()
                    }
                ]);

                // Start polling for job completion
                let project;
                try {
                    project = await pollJobStatus(jobData.jobId);
                } catch (pollError) {
                    logger.error('❌ Async job failed:', pollError);
                    throw pollError; // Re-throw to be caught by outer catch block
                }

                // Project is now ready, continue with normal flow
                logger.log('📦 Project generated successfully via async processing:', {
                    projectId: project.projectId,
                });

                // Rest of the success handling is below in the common code path
                logger.log('✅ Generation complete, updating UI state...');
                onProjectGenerated(project);
                logger.log('✅ Project state updated via onProjectGenerated');
                setCurrentPhase('editing');
                logger.log('✅ Phase set to editing');

                // Add generation success message to chat
                const aiMessage = project.generatedFiles && project.generatedFiles.length > 0
                    ? `🎉 Your miniapp has been created! I've generated ${project.generatedFiles.length} files and your app is now running. You can preview it on the right and continue chatting with me to make changes.`
                    : '🎉 Your miniapp has been created! The preview should be available shortly. You can continue chatting with me to make changes.';

                const successMsg: ChatMessage = {
                    role: 'ai',
                    content: aiMessage,
                    changedFiles: project.generatedFiles || [],
                    phase: 'editing',
                    timestamp: Date.now()
                };

                setChat(prev => [...prev, successMsg]);

                // Save success message to database
                if (project.projectId) {
                    try {
                        await fetch(`/api/projects/${project.projectId}/chat`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                            body: JSON.stringify({
                                role: 'ai',
                                content: aiMessage,
                                phase: 'editing',
                                changedFiles: project.generatedFiles || []
                            })
                        });
                    } catch (error) {
                        logger.warn('Failed to save success message to database:', error);
                    }
                }

                return; // Exit early for async flow
            }

            // Handle synchronous response (200 OK)
            if (!response.ok) {
                const errorData = await response.json();
                const errorMessage = errorData.details || errorData.error || 'Failed to generate project';
                logger.error('Generation error details:', errorData);
                throw new Error(errorMessage);
            }
            const project = await response.json();

            logger.log('📦 Project generated successfully:', {
                projectId: project.projectId,
                chatProjectIdMatches: project.projectId === chatProjectId
            });

            // Chat messages are already in the right place! No migration needed
            // because /api/chat created the project first and saved messages there

            // Mark as new deployment for delay logic
            project.isNewDeployment = true;

            logger.log('✅ Generation complete, updating UI state...');
            onProjectGenerated(project);
            logger.log('✅ Project state updated via onProjectGenerated');
            setCurrentPhase('editing');
            logger.log('✅ Phase set to editing');

            // Add generation success message to chat
            const aiMessage = project.generatedFiles && project.generatedFiles.length > 0
                ? `🎉 Your miniapp has been created! I've generated ${project.generatedFiles.length} files and your app is now running. You can preview it on the right and continue chatting with me to make changes.`
                : '🎉 Your miniapp has been created! The preview should be available shortly. You can continue chatting with me to make changes.';

            const successMsg: ChatMessage = {
                role: 'ai',
                content: aiMessage,
                changedFiles: project.generatedFiles || [],
                phase: 'editing',
                timestamp: Date.now()
            };

            setChat(prev => [...prev, successMsg]);

            // Save success message to database
            if (project.projectId) {
                try {
                    await fetch(`/api/projects/${project.projectId}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                        body: JSON.stringify({
                            role: 'ai',
                            content: aiMessage,
                            phase: 'editing',
                            changedFiles: project.generatedFiles || []
                        })
                    });
                } catch (error) {
                    logger.warn('Failed to save success message to database:', error);
                }
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An error occurred';

            logger.error('Generation failed:', errorMessage);
            
            // Format deployment errors more clearly
            let displayMessage = errorMessage;
            if (errorMessage.includes('Deployment failed')) {
                // Extract the specific error from deployment failure message
                // Try both patterns: "Deployment failed after N attempts: error" and "Deployment failed: error"
                const matchWithAttempts = errorMessage.match(/Deployment failed after \d+ attempts: (.+)/);
                const matchSimple = errorMessage.match(/Deployment failed: (.+)/);
                const match = matchWithAttempts || matchSimple;
                
                if (match) {
                    const deployError = match[1];
                    displayMessage = `❌ **Deployment Failed**\n\nYour app was generated successfully, but deployment to Vercel failed with the following error:\n\n\`\`\`\n${deployError.substring(0, 500)}\n\`\`\`\n\nPlease check the error above and try again. Common issues include:\n- TypeScript errors\n- Missing dependencies\n- Configuration issues`;
                } else {
                    // Fallback: show the full error message
                    displayMessage = `❌ **Deployment Failed**\n\n${errorMessage}`;
                }
            }
            
            // setError(errorMessage);
            const errorContent = displayMessage.includes('**Deployment Failed**') ? displayMessage : `❌ ${displayMessage}`;
            const genErrorMsg: ChatMessage = {
                role: 'ai',
                content: errorContent,
                phase: 'building',
                timestamp: Date.now()
            };
            
            setChat(prev => [...prev, genErrorMsg]);
            
            // Save generation error message to database
            const projectIdToSave = chatProjectId || currentProject?.projectId;
            if (projectIdToSave) {
                try {
                    await fetch(`/api/projects/${projectIdToSave}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
                        body: JSON.stringify({
                            role: 'ai',
                            content: errorContent,
                            phase: 'building'
                        })
                    });
                    logger.log('💾 Generation error message saved to database');
                } catch (saveError) {
                    logger.error('❌ Failed to save generation error message to database:', saveError);
                }
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const adjustTextareaHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setPrompt(e.target.value);
    };

    useEffect(() => {
        adjustTextareaHeight();
    }, [prompt]);

    // const handleCleanup = async () => {
    //     if (!currentProject) return;
    //     try {
    //         await fetch('/api/generate', {
    //             method: 'DELETE',
    //             headers: { 'Content-Type': 'application/json' },
    //             body: JSON.stringify({ projectId: currentProject.projectId }),
    //         });
    //         onProjectGenerated(null);
    //         setChat([]);
    //         setCurrentPhase('requirements');
    //     } catch (error) {
    //         logger.error('Failed to cleanup project:', error);
    //     }
    // };

    // const handleResetChat = () => {
    //     setChat([]);
    //     setCurrentPhase('requirements');
    //     onProjectGenerated(null);
    //     setPrompt('');
    //     setError(null);
    // };



    // const getPhaseBadge = (phase: string) => {
    //     switch (phase) {
    //     case 'requirements':
    //         return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-black-10 text-black">Planning</span>;
    //     case 'building':
    //         return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-black-20 text-black">Building</span>;
    //     case 'editing':
    //         return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-black-30 text-black">Editing</span>;
    //     default:
    //         return null;
    //     }
    // };

    return (
        <div className="flex-1 w-full flex flex-col bg-[#0000000A] h-full overflow-hidden">
            {/* Chat Messages */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-[20px] pt-4 min-h-0">
                <div className="space-y-4">
                    {chat.map((msg, idx) => (
                        <div key={idx} className={`flex gap-1 items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {/* Profile Picture for AI (left side) */}
                            {msg.role === 'ai' && (
                                <Image 
                                    src={getMinidevPfp(appType)}
                                    alt="MiniDev"
                                    width={32}
                                    height={32}
                                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1"
                                />
                            )}
                            
                            <div className={`rounded-lg px-1 py-2 max-w-[80%] text-sm ${msg.role === 'user'
                                ? 'bg-transparent text-black break-all'
                                : 'bg-transparent text-black'
                                }`}>
                                {/* <div className="flex items-center gap-2 mb-1">
                                    {msg.phase && getPhaseBadge(msg.phase)}
                                </div> */}
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        p: ({ children }) => <p>{children}</p>,
                                        h1: ({ children }) => <h1 className="text-xl font-bold mb-4">{children}</h1>,
                                        h2: ({ children }) => <h2 className="text-base font-semibold mb-3">{children}</h2>,
                                        h3: ({ children }) => <h3 className="text-base font-semibold mb-2">{children}</h3>,
                                        ul: ({ children }) => <ul className="list-disc ml-4 mb-3">{children}</ul>,
                                        li: ({ children }) => <li className="mb-1">{children}</li>,
                                        br: () => <br className="mb-2" />
                                    }}
                                >
                                    {msg.content}
                                </ReactMarkdown>
                                {msg.role === 'ai' && msg.changedFiles && msg.changedFiles.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span className="text-xs font-semibold text-green-600">
                                                {msg.changedFiles.length} file{msg.changedFiles.length !== 1 ? 's' : ''} updated
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-600 space-y-1">
                                            {msg.changedFiles.slice(0, 3).map((file, i) => (
                                                <div key={i} className="flex items-center gap-1">
                                                    <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                    <span className="font-mono">{file}</span>
                                                </div>
                                            ))}
                                            {msg.changedFiles.length > 3 && (
                                                <div className="text-xs text-gray-400 ml-4">
                                                    +{msg.changedFiles.length - 3} more file{msg.changedFiles.length - 3 !== 1 ? 's' : ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Profile Picture for User (right side) */}
                            {msg.role === 'user' && (
                                user?.pfpUrl ? (
                                    <Image 
                                        src={user.pfpUrl} 
                                        alt="User"
                                        width={32}
                                        height={32}
                                        className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0 mt-1">
                                        <span className="text-white font-medium text-xs">
                                            {user?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
                                        </span>
                                    </div>
                                )
                            )}
                        </div>
                    ))}
                    {aiLoading && (
                        <div className="flex gap-1 items-start justify-start">
                            <Image 
                                src={getMinidevPfp(appType)}
                                alt="MiniDev"
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-1"
                            />
                            <div className="rounded-lg px-1 py-1 max-w-[80%]">
                                <div className="flex items-center gap-1">
                                   
                                    <TextShimmer>
                                        Thinking...
                                    </TextShimmer>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={chatBottomRef} />
                </div>
            </div>

            {/* Chat Input - Fixed at bottom */}
            <div className="flex-shrink-0 pb-4 px-[20px] bg-gray-100">
                {/* Insufficient Credits Warning */}
                {shouldBlockChat && (
                    <div className="mb-3">
                        <div className="bg-red-50 border border-red-200 rounded-full px-4 py-2.5 text-sm">
                            <div className="flex items-center gap-2">
                                <div className="flex-shrink-0 mt-0.5">
                                    <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="text-red-700">
                                    <p className="font-normal text-xs">Insufficient credits. Please top up to continue chatting (1 credit per message).</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* Beta Warning Message */}
                {chat.length === 1 && hasShownWarning && !shouldBlockChat && (
                    <div className="mb-3">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-full px-4 py-2.5 text-sm">
                            <div className="flex items-center gap-2">
                                <div className="flex-shrink-0 mt-0.5">
                                    <svg className="w-3.5 h-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="text-yellow-700">
                                    <p className="font-normal text-xs">This is a beta version—stick to simple ideas, as complex prompts may break or behave unexpectedly</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                <form
                    onSubmit={e => {
                        e.preventDefault();
                        if (prompt.trim() && !aiLoading && !shouldBlockChat) {
                            handleSendMessage(prompt.trim());
                        }
                    }}
                    className="bg-transparent text-black rounded-3xl p-2 border-2 border-black-10 mb-2 flex flex-col items-center gap-1"
                >
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={handleInputChange}
                        placeholder={shouldBlockChat ? "Insufficient credits - Please top up" : "Ask Minidev"}
                        className="w-full max-w-full max-h-[100px] overflow-y-auto resize-none p-2 bg-transparent rounded-lg border-none focus:outline-none focus:border-none font-funnel-sans text-black-80 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={aiLoading || isGenerating || shouldBlockChat}
                        rows={1}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (prompt.trim() && !aiLoading && !shouldBlockChat) {
                                    handleSendMessage(prompt.trim());
                                }
                            }
                        }}
                    />
                    <button
                        type="submit"
                        className="p-2 bg-black-80 rounded-full disabled:opacity-50 ml-auto disabled:cursor-not-allowed"
                        disabled={aiLoading || isGenerating || !prompt.trim() || shouldBlockChat}
                        title={shouldBlockChat ? "Insufficient credits - Please top up" : "Send message"}
                    >
                        {aiLoading ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    d="M4.2503 11.5713L12 3.82156L19.7498 11.5713"
                                    stroke="white"
                                    strokeWidth="2.78195"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M12 3.82185L12 20.1777"
                                    stroke="white"
                                    strokeWidth="2.78195"
                                    strokeLinecap="round"
                                />
                            </svg>
                        )}
                    </button>
                </form>
                <p className="text-xs text-gray-400 text-center">
                    Outputs are auto-generated — please review before deploying.
                </p>

                {/* Project Controls */}
                {/* {currentProject && (
                    <div className="mx-4 mb-4 p-3 bg-black-10 rounded-md border border-black-20">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-black">Project Active</span>
                            <button
                                onClick={handleCleanup}
                                className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                            >
                                Stop Server
                            </button>
                        </div>
                    </div>
                )} */}

                {/* {error && (
                    <div className="mx-4 mb-4 p-3 bg-red-900 border border-red-700 rounded-md">
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )} */}
            </div>
        </div>
    );
}); 