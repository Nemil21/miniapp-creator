import { NextRequest, NextResponse } from "next/server";
import { saveChatMessage, createProject } from "../../../lib/database";
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

interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
  projectConfirmed: boolean;
  finalRequirements?: {
    features: string[];
    functionality: string[];
    targetAudience: string;
    userFlow: string;
  };
}

const chatSessions = new Map<string, ChatSession>();
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
    console.warn("Failed to load chat messages from DB:", error);
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
    // Save to database
    await saveChatMessage(projectId, role, content, phase, changedFiles);
    
    // Update memory cache
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
    console.warn("Failed to save message to DB and cache:", error);
  }
}

const REQUIREMENTS_GATHERING_PROMPT = `You are an expert Farcaster Miniapp developer and requirements analyst.

GOAL: Understand user requirements quickly and propose a complete minimal solution with minimal questions. Make sure to have only minimal features and functionality as we are building a minimal Farcaster miniapp.
IMPORTANT: Respond ONLY in natural, conversational language. Do NOT mention technical programming details, file names, or code structure. The user doesn't understand programming, so keep everything in plain English.

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
- User: "Create a miniapp for airdrop erc20 tokens"
- You: "I understand you want to create a platform where people can give away tokens to others. Here's what I propose:
  1. **For Token Givers**: Users can select which tokens they want to give away, set how much to give, and choose who gets them
  2. **For Token Receivers**: Users can see available token giveaways and claim their share
  3. **Main Features**: Easy token selection, simple amount setting, automatic distribution to recipients
  Does this match what you have in mind, or would you prefer a different approach?"

Current conversation: {conversationHistory}`;

const CONFIRMATION_PROMPT = `You are finalizing requirements for a Farcaster Miniapp. The user has confirmed they want to proceed with building.

IMPORTANT: Write ONLY in natural, conversational language. Do NOT mention technical programming details, file names, code structure, or technical implementation details. The user doesn't understand programming, so describe everything in plain English.

Based on the conversation, provide a final summary and then PROCEED TO BUILD:

## 🎯 Final Project Summary
- **What We're Building**: Simple description of what the miniapp does for users
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

After providing this summary, end with: "Perfect! I'll now proceed to build your miniapp. This will take a moment while I create all the necessary files and set up the project structure. You'll see the preview appear shortly."`;

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  stream: boolean = false
): Promise<string | ReadableStream> {
  const apiKey = process.env.CLAUDE_API_KEY;
  console.log("Claude API key:", apiKey);
  if (!apiKey) throw new Error("Claude API key not set");

  const requestBody = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    stream: stream,
  };

  console.log("Claude API request body:", JSON.stringify(requestBody, null, 2));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log("Claude API response status:", response.status);
  console.log("Claude API response headers:", Object.fromEntries(response.headers.entries()));

  if (!response.ok) {
    const errorText = await response.text();
    console.log("Claude API error response:", errorText);
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
    const { sessionId, message, action, stream = false, projectId } = await request.json();

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

    // Determine the project ID to use
    let currentProjectId = projectId;
    
    // If no projectId provided, we need to create one for this chat session
    if (!currentProjectId) {
      // Check if this session already has a project mapped
      currentProjectId = sessionToProjectMap.get(sessionId);
      
      // If still no project, create one
      if (!currentProjectId) {
        try {
          const draftProject = await createProject(
            user.id,
            `Chat Project ${sessionId.substring(0, 8)}`,
            "Chat conversation project",
            undefined
          );
          currentProjectId = draftProject.id;
          sessionToProjectMap.set(sessionId, currentProjectId);
          console.log(`Created project ${currentProjectId} for session ${sessionId}`);
        } catch (error) {
          console.warn("Failed to create project:", error);
          return NextResponse.json(
            { error: "Failed to create project for chat" },
            { status: 500 }
          );
        }
      }
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
      console.log(`Loaded ${existingMessages.length} messages from DB for project ${currentProjectId}`);
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
          ? CONFIRMATION_PROMPT.replace("{requirements}", conversationHistory)
          : REQUIREMENTS_GATHERING_PROMPT.replace(
              "{conversationHistory}",
              conversationHistory
            );

      const streamResponse = (await callClaude(
        systemPrompt,
        message,
        true
      )) as ReadableStream;

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
        message.toLowerCase().includes("that works");

      if (action === "confirm_project" || userConfirmed) {
        const requirements = session.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        const systemPrompt = CONFIRMATION_PROMPT.replace(
          "{requirements}",
          requirements
        );
        aiResponse = (await callClaude(systemPrompt, message)) as string;
        session.projectConfirmed = true;
      } else {
        const conversationHistory = session.messages
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        const systemPrompt = REQUIREMENTS_GATHERING_PROMPT.replace(
          "{conversationHistory}",
          conversationHistory
        );
        aiResponse = (await callClaude(systemPrompt, message)) as string;
      }

      // Save AI message to database and update cache
      await saveMessageToDBAndCache(
        currentProjectId, 
        "ai", 
        aiResponse, 
        action === "confirm_project" ? "building" : "requirements"
      );

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
    console.error("Chat API error:", error);
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
    console.error("Chat messages retrieval error:", error);
    return NextResponse.json(
      {
        error: "Failed to retrieve chat messages",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
