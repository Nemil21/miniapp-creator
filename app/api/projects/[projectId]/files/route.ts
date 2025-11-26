import { logger } from "../../../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { createPreview } from "@/lib/previewManager";
import { getProjectById, getProjectFiles, upsertProjectFile } from "@/lib/database";
import fs from "fs-extra";
import path from "path";

function getProjectBaseDir(projectId: string): string {
  return process.env.NODE_ENV === 'production'
    ? path.join("/tmp/generated", projectId)
    : path.join(process.cwd(), "generated", projectId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Verify authentication
    const auth = await authenticateRequest(req);
    if (!auth.isAuthorized || !auth.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId } = await params;
    const { filePath, content, redeploy } = await req.json();

    if (!filePath || content === undefined) {
      return NextResponse.json(
        { error: "filePath and content are required" },
        { status: 400 }
      );
    }

    logger.log(`📝 Updating file: ${filePath} in project: ${projectId}`);
    logger.log(`🔄 Redeploy requested: ${redeploy}`);

    // Get project directory
    const projectDir = getProjectBaseDir(projectId);
    const fullFilePath = path.join(projectDir, filePath);

    // Ensure the file exists in the project
    if (!fullFilePath.startsWith(projectDir)) {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 400 }
      );
    }

    // Create directory if it doesn't exist
    await fs.ensureDir(path.dirname(fullFilePath));

    // Write the updated content to filesystem
    await fs.writeFile(fullFilePath, content, "utf-8");
    logger.log(`✅ File updated on disk: ${filePath}`);

    // CRITICAL: Also save to database to ensure it's included in deployments
    await upsertProjectFile(projectId, filePath, content);
    logger.log(`✅ File saved to database: ${filePath}`);

    // If redeploy is requested, trigger a new deployment
    if (redeploy) {
      logger.log(`🚀 Triggering redeployment for project: ${projectId}`);

      try {
        // CRITICAL: Read files from DATABASE, not filesystem
        // This ensures all user edits are included in the deployment
        const dbFiles = await getProjectFiles(projectId);
        const files = dbFiles.map(f => ({
          filename: f.filename,
          content: f.content
        }));
        logger.log(`📦 Read ${files.length} files from DATABASE for redeployment`);

        // Get project's app type from database
        const project = await getProjectById(projectId);
        const appType = (project?.appType as 'farcaster' | 'web3') || 'farcaster';
        logger.log(`🎯 Project app type: ${appType}`);

        // Use PREVIEW_AUTH_TOKEN to authenticate with orchestrator
        // NOT the user's session token
        const previewAuthToken = process.env.PREVIEW_AUTH_TOKEN || '';

        // Trigger deployment with correct boilerplate based on project's app type
        const previewData = await createPreview(
          projectId,
          files,
          previewAuthToken,
          appType, // Which boilerplate to use
          undefined, // isWeb3 - not deploying contracts
          true  // skipContracts - already deployed
        );

        logger.log(`✅ Redeployment triggered`);
        logger.log(`🌐 Preview URL: ${previewData.previewUrl || previewData.vercelUrl}`);

        return NextResponse.json({
          success: true,
          message: "File updated and redeployment triggered",
          filePath,
          deploymentUrl: previewData.previewUrl || previewData.vercelUrl,
          status: previewData.status
        });
      } catch (deployError) {
        logger.error(`❌ Redeployment failed:`, deployError);
        return NextResponse.json({
          success: false,
          message: "File updated but redeployment failed",
          filePath,
          error: deployError instanceof Error ? deployError.message : String(deployError)
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      message: "File updated successfully",
      filePath
    });
  } catch (error) {
    logger.error("Error updating file:", error);
    return NextResponse.json(
      { error: "Failed to update file" },
      { status: 500 }
    );
  }
}
