import { logger } from "../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getGenerationJobById, getUserByPrivyId } from "../../../../lib/database";
import { authenticateRequest } from "../../../../lib/auth";

/**
 * GET /api/jobs/[id]
 * Get the status of a generation job
 * Client polls this endpoint to check if generation is complete
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await params (required in Next.js 15)
    const { id: jobId } = await params;

    // Check for auth bypass (testing only)
    const bypassAuth = request.headers.get("X-Bypass-Auth") === "true";
    const testUserId = request.headers.get("X-Test-User-Id");

    let user;

    if (bypassAuth && testUserId) {
      // For testing: Look up database user ID from privy_user_id
      // (testUserId is the privy_user_id, but we need the actual database user.id)
      const dbUser = await getUserByPrivyId(testUserId);
      if (!dbUser) {
        return NextResponse.json(
          { error: "Test user not found in database" },
          { status: 404 }
        );
      }
      user = { id: dbUser.id };
    } else {
      // Authenticate the request
      const authResult = await authenticateRequest(request);

      if (!authResult.isAuthorized || !authResult.user) {
        return NextResponse.json(
          { error: authResult.error || "Authentication required" },
          { status: 401 }
        );
      }

      user = authResult.user;
    }

    if (!jobId) {
      return NextResponse.json(
        { error: "Missing job ID" },
        { status: 400 }
      );
    }

    // Fetch job from database
    const job = await getGenerationJobById(jobId);

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    // Verify that the job belongs to the authenticated user
    if (job.userId !== user.id) {
      return NextResponse.json(
        { error: "Unauthorized - Job belongs to different user" },
        { status: 403 }
      );
    }

    // Return job status
    const response = {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
    };

    // Add cache headers to prevent aggressive caching during polling
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    logger.error("❌ Error fetching job status:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch job status",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
