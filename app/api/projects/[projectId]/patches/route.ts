import { logger } from "../../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getProjectPatches, revertPatch } from "../../../../../lib/database";
import { authenticateRequest } from "../../../../../lib/auth";

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

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const patches = await getProjectPatches(projectId);

    return NextResponse.json({
      success: true,
      patches,
      total: patches.length,
    });
  } catch (err) {
    logger.error("Error fetching project patches:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch project patches",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    const { patchId, action } = await request.json();

    if (!patchId || !action) {
      return NextResponse.json(
        { error: "Patch ID and action are required" },
        { status: 400 }
      );
    }

    if (action === "revert") {
      const patch = await revertPatch(patchId);

      // TODO: Implement actual file reversion logic here
      // This should apply the inverse of the patch to restore previous state

      return NextResponse.json({
        success: true,
        patch,
        message: "Patch reverted successfully",
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (err) {
    logger.error("Error managing patch:", err);
    return NextResponse.json(
      {
        error: "Failed to manage patch",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
