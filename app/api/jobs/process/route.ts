import { NextRequest, NextResponse } from "next/server";
import { getGenerationJobById, updateGenerationJobStatus, getPendingGenerationJobs } from "../../../../lib/database";
import { executeGenerationJob } from "../../../../lib/generationWorker";

// Extend function timeout to 5 minutes (max for Vercel Pro)
// This allows long-running generation jobs to complete
export const maxDuration = 600; // 10 minutes in seconds

/**
 * Background worker endpoint for processing generation jobs
 * This endpoint should be called periodically (e.g., via a cron job or polling)
 * to process pending generation jobs
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const workerToken = process.env.WORKER_AUTH_TOKEN;

    // Basic auth protection for worker endpoint
    if (!workerToken || authHeader !== `Bearer ${workerToken}`) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid worker token" },
        { status: 401 }
      );
    }

    const { jobId } = await request.json();

    if (jobId) {
      // Process specific job
      console.log(`🔧 Processing specific job: ${jobId}`);
      const job = await getGenerationJobById(jobId);

      if (!job) {
        return NextResponse.json(
          { error: "Job not found" },
          { status: 404 }
        );
      }

      if (job.status !== "pending") {
        return NextResponse.json(
          { error: `Job is already ${job.status}` },
          { status: 400 }
        );
      }

      // Mark as processing
      await updateGenerationJobStatus(jobId, "processing");

      // Execute the job and wait for completion
      // This allows full logging and ensures job completes in serverless environment
      console.log(`⏳ Waiting for job ${jobId} to complete...`);
      await executeGenerationJob(jobId);
      console.log(`✅ Job ${jobId} completed successfully`);

      return NextResponse.json({
        success: true,
        jobId,
        status: "completed",
        message: "Job processing completed",
      });
    } else {
      // Process next pending job from queue
      console.log("🔧 Checking for pending jobs...");
      const pendingJobs = await getPendingGenerationJobs(1);

      if (pendingJobs.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No pending jobs",
        });
      }

      const job = pendingJobs[0];
      console.log(`🔧 Processing job: ${job.id}`);

      // Mark as processing
      await updateGenerationJobStatus(job.id, "processing");

      // Execute the job and wait for completion
      // This allows full logging and ensures job completes in serverless environment
      console.log(`⏳ Waiting for job ${job.id} to complete...`);
      await executeGenerationJob(job.id);
      console.log(`✅ Job ${job.id} completed successfully`);

      return NextResponse.json({
        success: true,
        jobId: job.id,
        status: "completed",
        message: "Job processing completed",
      });
    }
  } catch (error) {
    console.error("❌ Error processing job:", error);
    return NextResponse.json(
      {
        error: "Failed to process job",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Get status of all jobs (for monitoring)
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const workerToken = process.env.WORKER_AUTH_TOKEN;

    if (!workerToken || authHeader !== `Bearer ${workerToken}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const pendingJobs = await getPendingGenerationJobs(10);

    return NextResponse.json({
      pendingCount: pendingJobs.length,
      jobs: pendingJobs.map(job => ({
        id: job.id,
        userId: job.userId,
        status: job.status,
        createdAt: job.createdAt,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching job status:", error);
    return NextResponse.json(
      { error: "Failed to fetch job status" },
      { status: 500 }
    );
  }
}
