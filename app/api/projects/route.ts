import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { 
  createProject, 
  getProjectsByUserId, 
  getProjectById,
  updateProject,
  deleteProject,
  saveProjectFiles} from "../../../lib/database";
import { authenticateRequest } from "../../../lib/auth";

// GET /api/projects - Get all projects for a user
export async function GET(request: NextRequest) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }
    
    const projects = await getProjectsByUserId(user.id);
    
    return NextResponse.json({
      success: true,
      projects,
    });
  } catch (error) {
    logger.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { name, description, files, appType = 'farcaster' } = await request.json();

    if (!name) {
      return NextResponse.json(
        { error: "Project name is required" },
        { status: 400 }
      );
    }

    // Create the project
    const project = await createProject(user.id, name, description, undefined, undefined, appType);

    // Save project files if provided
    if (files && Array.isArray(files)) {
      await saveProjectFiles(project.id, files);
    }

    return NextResponse.json({
      success: true,
      project,
    });
  } catch (error) {
    logger.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}

// PUT /api/projects - Update a project
export async function PUT(request: NextRequest) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { projectId, ...updates } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Check if user owns this project
    const project = await getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
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

// DELETE /api/projects - Delete a project
export async function DELETE(request: NextRequest) {
  try {
    const { user, isAuthorized, error } = await authenticateRequest(request);
    if (!isAuthorized || !user) {
      return NextResponse.json(
        { error: error || "Authentication required" },
        { status: 401 }
      );
    }

    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Check if user owns this project
    const project = await getProjectById(projectId);
    if (!project || project.userId !== user.id) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
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
