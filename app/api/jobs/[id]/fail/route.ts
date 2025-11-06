import { logger } from "../../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { updateGenerationJobStatus } from "../../../../../lib/database";

/**
 * Endpoint for the orchestrator to retroactively mark a job as failed
 * This is called when background deployment fails after the job was already marked as completed
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const orchestratorToken = process.env.ORCHESTRATOR_AUTH_TOKEN || process.env.PREVIEW_AUTH_TOKEN;

    // Auth check - orchestrator must authenticate
    if (!orchestratorToken || authHeader !== `Bearer ${orchestratorToken}`) {
      logger.error("❌ Orchestrator authentication failed");
      return NextResponse.json(
        { error: "Unauthorized - Invalid orchestrator token" },
        { status: 401 }
      );
    }

    const { id: jobId } = await params;
    const body = await request.json();
    const { error, logs, deploymentError } = body;

    logger.log(`🔄 Retroactively marking job ${jobId} as failed`);
    logger.log(`   Error: ${error?.substring(0, 200) || 'No error message'}`);
    logger.log(`   Logs: ${logs ? `${logs.length} chars` : 'No logs'}`);

    // Create error details object
    const errorDetails = {
      status: 'background_deployment_failed',
      deploymentError: deploymentError || error,
      deploymentLogs: logs ? logs.substring(0, 1000) : undefined,
      failedAt: new Date().toISOString()
    };

    // Update job status to failed
    await updateGenerationJobStatus(
      jobId,
      'failed',
      errorDetails,
      deploymentError || error || 'Background deployment failed'
    );

    logger.log(`✅ Job ${jobId} marked as failed in database`);

    return NextResponse.json({
      success: true,
      message: 'Job marked as failed',
      jobId
    });

  } catch (error) {
    logger.error('❌ Error updating job status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to update job status',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

