import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { saveChatMessage, migrateChatMessages } from "../../../lib/database";
import { authenticateRequest } from "../../../lib/auth";
import { db, chatMessages } from "../../../db";
import { eq } from "drizzle-orm";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  phase?: string;
  changedFiles?: string[];
}

import { chatSessions } from "../../../lib/chatSessionManager";

const sessionToProjectMap = new Map<string, string>(); // Maps sessionId to projectId

// Helper function to load chat messages from database and hydrate memory cache
async function loadChatMessagesFromDB(projectId: string): Promise<ChatMessage[]> {
  try {
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.projectId, projectId))
      .orderBy(chatMessages.timestamp);
    
    return messages.map(msg => ({
      role: msg.role as "user" | "ai",
      content: msg.content,
      timestamp: new Date(msg.timestamp).getTime(),
      phase: msg.phase || undefined,
      changedFiles: msg.changedFiles as string[] | undefined
    }));
  } catch (error) {
    logger.warn("Failed to load chat messages from DB:", error);
    return [];
  }
}

// Helper function to save message to DB and update memory cache
async function saveMessageToDBAndCache(
  projectId: string, 
  role: "user" | "ai", 
  content: string, 
  phase?: string, 
  changedFiles?: string[]
): Promise<void> {
  try {
    // Skip database save for temporary sessions (no draft project yet)
    if (!projectId.startsWith('temp-')) {
      // Save to database only for real projects
      await saveChatMessage(projectId, role, content, phase, changedFiles);
    } else {
      logger.log(`💭 Message stored in memory only (no project yet): ${role}`);
    }
    
    // Always update memory cache
    const session = chatSessions.get(projectId);
    if (session) {
      session.messages.push({
        role,
        content,
        timestamp: Date.now(),
        phase,
        changedFiles
      });
    }
  } catch (error) {
    logger.warn("Failed to save message to DB and cache:", error);
  }
}

function getRequirementsGatheringPrompt(appType: 'farcaster' | 'web3') {
  const appTypeLabel = appType === 'farcaster' ? 'Farcaster Miniapp' : 'Web3 Web App';
  const appTypeDescription = appType === 'farcaster' 
    ? 'a minimal Farcaster miniapp'
    : 'a minimal Web3 web app';
  
  return `You are an expert ${appTypeLabel} developer and requirements analyst.

GOAL: Understand user requirements quickly and propose a complete minimal solution with minimal questions. Make sure to have only minimal features and functionality as we are building ${appTypeDescription}.
IMPORTANT: Respond ONLY in natural, conversational language. DO NOT mention technical programming details, file names, or code structure. The user doesn't understand programming, so keep everything in plain English.

CRITICAL: When the user confirms your proposal (says "yes", "proceed", "continue", "build", etc.), immediately move to the confirmation phase. Do NOT ask more questions or repeat the proposal.

Your approach:
1. **Analyze the user's initial description** to understand the core concept
2. **Propose a complete project flow** based on your understanding
3. **Ask only 1-2 critical clarifying questions** if needed
4. **Present the full solution** and ask for confirmation
5. **When user confirms, immediately proceed to build** - don't ask more questions

Guidelines:
- **Use natural language only**: No technical jargon, programming terms, or file references
- **Focus on user experience**: Describe what users will see and do
- **Explain in simple terms**: Use everyday language to describe features
- **Make smart assumptions**: Use common patterns and best practices
- **Be concise**: Get to the solution quickly with minimal back-and-forth
- **Recognize confirmation**: When user says yes/proceed/continue, move to building phase

Example approach:
- User: "Create ${appType === 'farcaster' ? 'a miniapp' : 'an app'} for airdrop erc20 tokens"
- You: "I understand you want to create a platform where people can give away tokens to others. Here's what I propose:
  1. **For Token Givers**: Users can select which tokens they want to give away, set how much to give, and choose who gets them
  2. **For Token Receivers**: Users can see available token giveaways and claim their share
  3. **Main Features**: Easy token selection, simple amount setting, automatic distribution to recipients
  Does this match what you have in mind, or would you prefer a different approach?"

Current conversation: {conversationHistory}`;
}

function getConfirmationPrompt(appType: 'farcaster' | 'web3') {
  const appTypeLabel = appType === 'farcaster' ? 'Farcaster Miniapp' : 'Web3 Web App';
  const appTypeWord = appType === 'farcaster' ? 'miniapp' : 'app';
  
  return `You are finalizing requirements for a ${appTypeLabel}. The user has confirmed they want to proceed with building.

IMPORTANT: Write ONLY in natural, conversational language. DO NOT mention technical programming details, file names, code structure, or technical implementation details. The user doesn't understand programming, so describe everything in plain English.

Based on the conversation, provide a final summary and then PROCEED TO BUILD:

## 🎯 Final Project Summary
- **What We're Building**: Simple description of what the ${appTypeWord} does for users
- **Who Will Use It**: Clear description of the target audience  
- **What Problem It Solves**: The main benefit users will get

## 🚀 What Users Can Do
- **Main Features**: What users will be able to do with the app
- **User Experience**: How users will interact with the app
- **Key Actions**: The main things users will do

## 🎨 How It Will Look and Feel
- **User Interface**: How the app will look to users
- **User Journey**: Step-by-step description of how users will use it
- **Key Interactions**: The main ways users will interact

Requirements gathered: {requirements}

After providing this summary, end with: "Perfect! I'll now proceed to build your ${appTypeWord}. This will take a moment while I create all the necessary files and set up the project structure. You'll see the preview appear shortly."`;
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  stream: boolean = false
): Promise<string | ReadableStream> {
  const apiKey = process.env.CLAUDE_API_KEY;
  // logger.log("Claude API key:", apiKey);
  if (!apiKey) throw new Error("Claude API key not set");

  const requestBody = {
    model: "claude-3-5-haiku-20241022",
    max_tokens: 4000,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    stream: stream,
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  if (stream) {
    return response.body as ReadableStream;
  } else {
    const data = await response.json();
    return data.content[0]?.text || "";
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, message, action, stream = false, projectId, walletAddress, appType = 'farcaster' } = await request.json();

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "Missing sessionId or message" },
        { status: 400 }
      );
    }

    // Authenticate the user to get their ID
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    // SERVER-SIDE CREDIT VALIDATION
    // Import at runtime to avoid issues if module doesn't exist yet
    const { validateCredits, trackCredits, captureCredits } = await import('../../../lib/creditValidation');
    
    let creditEventId: string | null = null;
    
    // Validate credits before processing (only if wallet address is provided)
    if (walletAddress) {
      const validation = await validateCredits(walletAddress, 1);
      if (!validation.isValid) {
        return NextResponse.json(
          { 
            error: 'Insufficient credits', 
            details: validation.error,
            currentCredits: validation.currentCredits
          },
          { status: 402 } // 402 Payment Required
        );
      }

      // Track credits before processing
      try {
        creditEventId = await trackCredits(walletAddress, 1);
        logger.log('Server-side credit tracking initiated:', creditEventId);
      } catch {
        return NextResponse.json(
          { error: 'Insufficient credits', details: 'Unable to reserve credits for this operation' },
          { status: 402 }
        );
      }
    }

    // Add exponential backoff retry logic for Claude API calls
    const maxRetries = 5; // Increased retries
    const baseDelay = 1000; // 1 second base delay
    
    async function retryClaudeCall(systemPrompt: string, message: string, stream: boolean) {
      let lastError;
      
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await callClaude(systemPrompt, message, stream);
        } catch (error) {
          lastError = error;
          
          // Check if error is due to overload
          if (error instanceof Error && error.message.includes('overloaded_error')) {
            const exponentialDelay = baseDelay * Math.pow(2, i); // Exponential backoff
            const jitter = Math.random() * 1000; // Add random jitter up to 1 second
            const totalDelay = exponentialDelay + jitter;
            
            logger.log(`Claude API overloaded, retry attempt ${i + 1} of ${maxRetries}. Waiting ${totalDelay}ms`);
            await new Promise(resolve => setTimeout(resolve, totalDelay));
            continue;
          }
          
          throw error; // Throw non-overload errors immediately
        }
      }
      
      throw new Error(`Failed after ${maxRetries} retries: ${lastError}`);
    }

    // Determine the project ID to use
    let currentProjectId = projectId;
    
    // If no projectId provided, we need to create one for this chat session
    if (!currentProjectId) {
      // Check if this session already has a project mapped (in-memory)
      const mappedProjectId = sessionToProjectMap.get(sessionId);
      
      // If we have a mapped project, verify it's still valid (not completed)
      if (mappedProjectId) {
        try {
          const projectMessages = await db.select().from(chatMessages)
            .where(eq(chatMessages.projectId, mappedProjectId))
            .orderBy(chatMessages.timestamp);
          
          const hasCompletionMessage = projectMessages.some(msg => 
            msg.content.includes('Your miniapp has been created') || 
            msg.content.includes('files generated') ||
            msg.content.includes('I\'ve generated') ||
            msg.phase === 'editing'
          );
          
          if (hasCompletionMessage) {
            logger.log(`🚫 Clearing stale mapping for session ${sessionId} - project ${mappedProjectId} is completed`);
            sessionToProjectMap.delete(sessionId);
          } else {
            currentProjectId = mappedProjectId;
            logger.log(`✅ Using mapped project ${mappedProjectId} for session ${sessionId}`);
          }
        } catch (error) {
          logger.warn(`Failed to verify mapped project ${mappedProjectId}:`, error);
          // On error, clear the mapping to be safe
          sessionToProjectMap.delete(sessionId);
        }
      }
      
      // If not in memory (or mapping was invalid), check database for existing draft projects
      // ONLY if this is truly a continuation (recent messages in the last 5 minutes)
      if (!currentProjectId) {
        try {
          const { getProjectsByUserId } = await import('../../../lib/database');
          const userProjects = await getProjectsByUserId(user.id);
          
          // Look for VERY recent draft project that's actively being used
          // Changed from 24 hours to 5 minutes to prevent cross-chat contamination
          const recentDraft = await (async () => {
            for (const p of userProjects) {
              if (p.vercelUrl || p.previewUrl) continue; // Skip deployed projects
              
              // Use updatedAt (last message time) instead of createdAt for better accuracy
              const timeSinceLastUpdate = Date.now() - new Date(p.updatedAt || p.createdAt).getTime();
              const isActivelyUsed = timeSinceLastUpdate < 5 * 60 * 1000; // Within 5 minutes
              const isDraft = p.name.startsWith('Chat Project');
              
              if (!isActivelyUsed || !isDraft) continue;
              
              // Additional check: Don't reuse projects that have completion messages
              // This prevents reusing finished projects even if they're recent
              try {
                const projectMessages = await db.select().from(chatMessages)
                  .where(eq(chatMessages.projectId, p.id))
                  .orderBy(chatMessages.timestamp);
                
                const hasCompletionMessage = projectMessages.some(msg => 
                  msg.content.includes('Your miniapp has been created') || 
                  msg.content.includes('files generated') ||
                  msg.content.includes('I\'ve generated') ||
                  msg.phase === 'editing'
                );
                
                if (hasCompletionMessage) {
                  logger.log(`🚫 Skipping project ${p.id} - has completion messages (finished project)`);
                  continue;
                }
                
                logger.log(`✅ Found active draft project: ${p.name}, id: ${p.id}, timeSinceUpdate: ${timeSinceLastUpdate}ms`);
                return p;
              } catch (error) {
                logger.warn(`Failed to check messages for project ${p.id}:`, error);
                continue;
              }
            }
            return null;
          })();
          
          if (recentDraft) {
            currentProjectId = recentDraft.id;
            sessionToProjectMap.set(sessionId, currentProjectId);
            logger.log(`📎 Resuming ACTIVE draft project ${currentProjectId} for session ${sessionId} (last updated within 5 min)`);
          } else {
            logger.log(`🚫 No active draft found - will create new project for fresh chat`);
          }
        } catch (error) {
          logger.warn("Failed to check for existing draft projects:", error);
        }
      }
      
      // NO DRAFT PROJECTS - Messages stay in memory until user confirms building
      // Project will be created during the generation phase with proper name
      if (!currentProjectId) {
        logger.log(`💬 No project yet - messages will be stored in memory until building phase`);
        // Use sessionId as temporary identifier for in-memory messages
        currentProjectId = `temp-${sessionId}`;
      }
    } else {
      logger.log(`📌 Using provided projectId: ${currentProjectId}`);
    }

    // Get or create chat session (using projectId as key for proper mapping)
    let session = chatSessions.get(currentProjectId);
    if (!session) {
      // Load existing messages from database
      const existingMessages = await loadChatMessagesFromDB(currentProjectId);
      
      session = {
        sessionId,
        messages: existingMessages,
        projectConfirmed: false,
      };
      chatSessions.set(currentProjectId, session);
      logger.log(`Loaded ${existingMessages.length} messages from DB for project ${currentProjectId}`);
    }

    // Sync project's appType with user's selection if it differs
    // This ensures the project uses the correct boilerplate when generated
    try {
      const { updateProject } = await import('../../../lib/database');
      await updateProject(currentProjectId, { appType });
      logger.log(`✅ Project ${currentProjectId} appType synced to: ${appType}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to sync project appType:`, error);
      // Non-critical error - continue with chat flow
    }

    // Save user message to database and update cache
    await saveMessageToDBAndCache(
      currentProjectId, 
      "user", 
      message, 
      action === "confirm_project" ? "building" : "requirements"
    );

    if (stream) {
      // Handle streaming response
      const conversationHistory = session.messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const systemPrompt =
        action === "confirm_project"
          ? getConfirmationPrompt(appType).replace("{requirements}", conversationHistory)
          : getRequirementsGatheringPrompt(appType).replace(
              "{conversationHistory}",
              conversationHistory
            );

      const streamResponse = await retryClaudeCall(systemPrompt, message, true) as ReadableStream;

      if (action === "confirm_project") {
        session.projectConfirmed = true;
      }

      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        },
      });
    } else {
      // Handle non-streaming response
      let aiResponse: string;

      // Check if user has confirmed the proposal
      const userConfirmed =
        message.toLowerCase().includes("yes") ||
        message.toLowerCase().includes("proceed") ||
        message.toLowerCase().includes("continue") ||
        message.toLowerCase().includes("build") ||
        message.toLowerCase().includes("go ahead") ||
        message.toLowerCase().includes("sounds good") ||
        message.toLowerCase().includes("perfect") ||
        message.toLowerCase().includes("that works") ||
        message.toLowerCase().includes("interested") ||
        message.toLowerCase().includes("forward") ||
        message.toLowerCase().includes("let's do it") ||
        message.toLowerCase().includes("lets do it") ||
        message.toLowerCase().includes("make it") ||
        message.toLowerCase().includes("create it") ||
        message.toLowerCase().includes("start") ||
        message.toLowerCase().includes("okay") ||
        message.toLowerCase().includes("sure") ||
        message.toLowerCase().includes("confirmed") ||
        message.toLowerCase().includes("agree");

      if (action === "confirm_project" || userConfirmed) {
        const requirements = session.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        const systemPrompt = getConfirmationPrompt(appType).replace(
          "{requirements}",
          requirements
        );
        aiResponse = await retryClaudeCall(systemPrompt, message, false) as string;
        session.projectConfirmed = true;
      } else {
        const conversationHistory = session.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        const systemPrompt = getRequirementsGatheringPrompt(appType).replace(
          "{conversationHistory}",
          conversationHistory
        );
        aiResponse = await retryClaudeCall(systemPrompt, message, false) as string;
      }

      // Save AI message to database and update cache
      await saveMessageToDBAndCache(
        currentProjectId, 
        "ai", 
        aiResponse, 
        action === "confirm_project" ? "building" : "requirements"
      );

      // Update project name from AI response if this is the first AI response
      // This replaces generic "Chat Project Nov 21" with actual project name
      if (session.messages.filter(m => m.role === 'ai').length === 0) {
        try {
          // Extract project name from AI response (look for quoted names or "App Concept:" patterns)
          const nameMatch = aiResponse.match(/["']([^"']{5,50})["']|App Concept:\s*["']?([^"\n]{5,50})["']?/i);
          if (nameMatch) {
            const extractedName = (nameMatch[1] || nameMatch[2]).trim();
            const { updateProject } = await import('../../../lib/database');
            await updateProject(currentProjectId, { 
              name: extractedName,
              description: message.substring(0, 200)
            });
            logger.log(`✏️ Updated project name to: ${extractedName}`);
          }
        } catch (error) {
          logger.warn('Failed to extract/update project name:', error);
          // Non-critical - continue
        }
      }

      // Capture credits after successful operation
      if (creditEventId) {
        await captureCredits(creditEventId);
      }

      return NextResponse.json({
        success: true,
        response: aiResponse,
        sessionId,
        projectId: currentProjectId,
        projectConfirmed: session.projectConfirmed,
        messageCount: session.messages.length,
      });
    }
  } catch (error) {
    logger.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: "Failed to process chat message",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    // Load messages from database
    const messages = await loadChatMessagesFromDB(projectId);
    
    // Update memory cache
    const session = chatSessions.get(projectId);
    if (session) {
      session.messages = messages;
    }

    return NextResponse.json({
      success: true,
      messages,
      projectId,
    });
  } catch (error) {
    logger.error("Chat messages retrieval error:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve chat messages",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// Migration endpoint for chat messages
export async function PUT(request: NextRequest) {
  try {
    const { fromProjectId, toProjectId } = await request.json();

    if (!fromProjectId || !toProjectId) {
      return NextResponse.json(
        { error: "Missing fromProjectId or toProjectId" },
        { status: 400 }
      );
    }

    // Authenticate the user
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    // Migrate chat messages
    const migratedMessages = await migrateChatMessages(fromProjectId, toProjectId);

    return NextResponse.json({
      success: true,
      migratedCount: migratedMessages.length,
      fromProjectId,
      toProjectId,
    });
  } catch (error) {
    logger.error("Chat migration error:", error);
    return NextResponse.json(
      {
        error: "Failed to migrate chat messages",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
