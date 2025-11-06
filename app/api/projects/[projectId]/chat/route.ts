import { logger } from "../../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { 
  saveChatMessage,
  getProjectChatMessages,
  clearProjectChatMessages
} from "../../../../../lib/database";
import { authenticateRequest } from "../../../../../lib/auth";

// GET /api/projects/[projectId]/chat - Get chat messages for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { projectId } = await params;
    const chatMessages = await getProjectChatMessages(projectId);

    return NextResponse.json({
      success: true,
      messages: chatMessages,
    });
  } catch (error) {
    logger.error("Error fetching chat messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat messages" },
      { status: 500 }
    );
  }
}

// POST /api/projects/[projectId]/chat - Save a chat message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { projectId } = await params;
    const { role, content, phase, changedFiles } = await request.json();

    if (!role || !content) {
      return NextResponse.json(
        { error: "Missing required fields: role, content" },
        { status: 400 }
      );
    }

    const message = await saveChatMessage(
      projectId,
      role,
      content,
      phase,
      changedFiles
    );

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error) {
    logger.error("Error saving chat message:", error);
    return NextResponse.json(
      { error: "Failed to save chat message" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId]/chat - Clear all chat messages for a project
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { projectId } = await params;
    await clearProjectChatMessages(projectId);

    return NextResponse.json({
      success: true,
      message: "Chat messages cleared successfully",
    });
  } catch (error) {
    logger.error("Error clearing chat messages:", error);
    return NextResponse.json(
      { error: "Failed to clear chat messages" },
      { status: 500 }
    );
  }
}
