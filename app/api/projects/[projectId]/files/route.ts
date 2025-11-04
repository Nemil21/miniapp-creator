import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { createPreview } from "@/lib/previewManager";
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

    console.log(`📝 Updating file: ${filePath} in project: ${projectId}`);
    console.log(`🔄 Redeploy requested: ${redeploy}`);

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

    // Write the updated content
    await fs.writeFile(fullFilePath, content, "utf-8");
    console.log(`✅ File updated: ${filePath}`);

    // If redeploy is requested, trigger a new deployment
    if (redeploy) {
      console.log(`🚀 Triggering redeployment for project: ${projectId}`);

      try {
        // Read all files from the project directory
        const files: { filename: string; content: string }[] = [];
        
        async function readDir(dir: string, baseDir: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            
            // Skip node_modules, .next, etc.
            if (
              entry.name === 'node_modules' ||
              entry.name === '.next' ||
              entry.name === '.vercel' ||
              entry.name === 'dist' ||
              entry.name === 'build'
            ) {
              continue;
            }
            
            if (entry.isDirectory()) {
              await readDir(fullPath, baseDir);
            } else {
              const content = await fs.readFile(fullPath, 'utf-8');
              files.push({
                filename: relativePath,
                content
              });
            }
          }
        }
        
        await readDir(projectDir, projectDir);
        console.log(`📦 Read ${files.length} files for redeployment`);

        // Use PREVIEW_AUTH_TOKEN to authenticate with orchestrator
        // NOT the user's session token
        const previewAuthToken = process.env.PREVIEW_AUTH_TOKEN || '';

        // Trigger deployment
        const previewData = await createPreview(
          projectId,
          files,
          previewAuthToken,
          true, // isWeb3
          true  // skipContracts - already deployed
        );

        console.log(`✅ Redeployment triggered`);
        console.log(`🌐 Preview URL: ${previewData.previewUrl || previewData.vercelUrl}`);

        return NextResponse.json({
          success: true,
          message: "File updated and redeployment triggered",
          filePath,
          deploymentUrl: previewData.previewUrl || previewData.vercelUrl,
          status: previewData.status
        });
      } catch (deployError) {
        console.error(`❌ Redeployment failed:`, deployError);
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
    console.error("Error updating file:", error);
    return NextResponse.json(
      { error: "Failed to update file" },
      { status: 500 }
    );
  }
}
