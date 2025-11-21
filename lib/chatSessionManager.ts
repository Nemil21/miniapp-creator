// Chat session manager - shared in-memory storage for chat sessions
// This is separate from the route to avoid Next.js route export restrictions

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

// In-memory storage for chat sessions
export const chatSessions = new Map<string, ChatSession>();
