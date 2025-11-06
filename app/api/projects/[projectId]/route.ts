import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { 
  getProjectById,
  updateProject,
  deleteProject,
  getProjectFiles,
  getProjectPatches,
  getProjectDeployments,
  getProjectChatMessages
} from "../../../../lib/database";
import { authenticateRequest } from "../../../../lib/auth";

// GET /api/projects/[projectId] - Get a specific project
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
    logger.log('🔍 GET /api/projects/[projectId] - projectId:', projectId, 'user.id:', user.id);

    const project = await getProjectById(projectId);
    logger.log('🔍 getProjectById result:', project ? 'found' : 'not found');
    
    if (!project) {
      logger.log('🔍 Project not found in database');
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    logger.log('🔍 Project found - userId:', project.userId, 'matches current user:', project.userId === user.id);

    // Check if user owns this project
    if (project.userId !== user.id) {
      logger.log('🔍 Access denied - user does not own project');
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Get project files
    const files = await getProjectFiles(projectId);
    
    // Get project patches (history)
    const patches = await getProjectPatches(projectId);
    
    // Get project deployments
    const deployments = await getProjectDeployments(projectId);
    
    // Get project chat messages
    const chatMessages = await getProjectChatMessages(projectId);

    return NextResponse.json({
      success: true,
      project: {
        ...project,
        files,
        patches,
        deployments,
        chatMessages,
      },
    });
  } catch (error) {
    logger.error("Error fetching project:", error);
    return NextResponse.json(
      { error: "Failed to fetch project" },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[projectId] - Update a specific project
export async function PUT(
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
    const updates = await request.json();

    const project = await getProjectById(projectId);
    
    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check if user owns this project
    if (project.userId !== user.id) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const updatedProject = await updateProject(projectId, updates);
    
    return NextResponse.json({
      success: true,
      project: updatedProject,
    });
  } catch (error) {
    logger.error("Error updating project:", error);
    return NextResponse.json(
      { error: "Failed to update project" },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[projectId] - Delete a specific project
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

    const project = await getProjectById(projectId);
    
    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check if user owns this project
    if (project.userId !== user.id) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    await deleteProject(projectId);
    
    return NextResponse.json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}