import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import {
  updatePreviewFiles,
  getGeneratedFile,
  listGeneratedFiles,
  updateGeneratedFile,
  deleteGeneratedFile,
} from "../../../lib/previewManager";
import { getProjectFiles } from "../../../lib/database";
import { headers } from "next/headers";

// GET: List files or fetch file content from generated directory
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("file");
    const projectId = searchParams.get("projectId");
    const listFiles = searchParams.get("listFiles") === "true";

    logger.log(
      `🔍 FILES GET request - projectId: ${projectId}, filePath: ${filePath}, listFiles: ${listFiles}`
    );

    if (!projectId) {
      logger.log(`❌ Missing project ID`);
      return NextResponse.json(
        { error: "Missing project ID" },
        { status: 400 }
      );
    }

    // Handle file listing request
    if (listFiles) {
      logger.log(
        `📋 Listing files from generated directory for project: ${projectId}`
      );
      try {
        let files = await listGeneratedFiles(projectId);
        logger.log(
          `📁 Found ${files.length} files in generated directory:`,
          files
        );

        // If no files found in generated directory, try database
        if (files.length === 0) {
          logger.log(`📋 No files in generated directory, checking database...`);
          const dbFiles = await getProjectFiles(projectId);
          files = dbFiles.map(f => f.filename);
          logger.log(
            `📁 Found ${files.length} files in database:`,
            files
          );
        }

        // Ensure we always return a valid JSON response
        const response = {
          files: files || [],
          projectId: projectId,
          totalFiles: files.length,
        };
        logger.log(`📤 Sending response:`, JSON.stringify(response, null, 2));
        return NextResponse.json(response);
      } catch (error) {
        logger.error(`❌ Error listing generated files:`, error);
        return NextResponse.json(
          { error: "Failed to list generated files" },
          { status: 500 }
        );
      }
    }

    // Handle file content request
    if (!filePath) {
      logger.log(`❌ Missing file path`);
      return NextResponse.json({ error: "Missing file path" }, { status: 400 });
    }

    // Security check: prevent directory traversal
    if (filePath.includes("..") || filePath.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filePath}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    logger.log(`🔍 Fetching file from generated directory: ${filePath}`);

    try {
      let content = await getGeneratedFile(projectId, filePath);

      if (!content) {
        logger.log(`❌ File not found in generated directory: ${filePath}, checking database...`);
        // Try to get from database
        const dbFiles = await getProjectFiles(projectId);
        const dbFile = dbFiles.find(f => f.filename === filePath);
        if (dbFile) {
          content = dbFile.content;
          logger.log(
            `✅ Found file in database: ${filePath} (${content.length} chars)`
          );
        } else {
          logger.log(`❌ File not found in database either: ${filePath}`);
          return NextResponse.json({ error: "File not found" }, { status: 404 });
        }
      } else {
        logger.log(
          `✅ Found file in generated directory: ${filePath} (${content.length} chars)`
        );
      }

      // Determine content type based on file extension
      const ext = path.extname(filePath);
      let contentType = "text/plain";

      if (ext === ".json") contentType = "application/json";
      else if (ext === ".tsx" || ext === ".ts") contentType = "text/typescript";
      else if (ext === ".jsx" || ext === ".js") contentType = "text/javascript";
      else if (ext === ".css") contentType = "text/css";
      else if (ext === ".html") contentType = "text/html";
      else if (ext === ".md") contentType = "text/markdown";

      logger.log(`📤 Sending file with content type: ${contentType}`);

      return new NextResponse(content, {
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      logger.error(`❌ Error fetching file from container:`, error);
      return NextResponse.json(
        { error: "Failed to fetch file from container" },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("❌ Error serving file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}

// PUT: Save file content to both local and container
export async function PUT(request: NextRequest) {
  try {
    const { projectId, filename, content } = await request.json();
    const accessToken = (await headers())
      .get("authorization")
      ?.replace("Bearer ", "");

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      );
    }

    logger.log(
      `💾 PUT request - projectId: ${projectId}, filename: ${filename}`
    );

    if (!projectId || !filename || content === undefined) {
      logger.log(`❌ Missing required fields`);
      return NextResponse.json(
        { error: "Missing projectId, filename, or content" },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    if (filename.includes("..") || filename.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filename}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Write to local filesystem (for backup and consistency)
    try {
      await updateGeneratedFile(projectId, filename, content);
      logger.log(`✅ File saved locally: ${filename}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to save file locally:`, error);
      // Don't fail the request if local save fails
    }

    // Update the preview with the new file (optional - may not be supported on Railway)
    try {
      await updatePreviewFiles(projectId, [{ filename, content }], accessToken);
      logger.log(`✅ Preview updated with file: ${filename}`);
    } catch (error) {
      logger.warn(`⚠️  Failed to update preview files (this is expected on Railway):`, error);
      logger.log(`📁 File ${filename} has been saved locally`);
      // Don't fail the request - preview updates are optional
    }

    return NextResponse.json({
      success: true,
      filename,
      projectId,
      message: "File saved successfully",
    });
  } catch (error) {
    logger.error("❌ Error saving file:", error);
    return NextResponse.json({ error: "Failed to save file" }, { status: 500 });
  }
}

// DELETE: Delete a file from both local and container
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const filename = searchParams.get("filename");

    logger.log(
      `🗑️ DELETE request - projectId: ${projectId}, filename: ${filename}`
    );

    if (!projectId || !filename) {
      logger.log(`❌ Missing projectId or filename`);
      return NextResponse.json(
        { error: "Missing projectId or filename" },
        { status: 400 }
      );
    }

    // Security check: prevent directory traversal
    if (filename.includes("..") || filename.startsWith("/")) {
      logger.log(`❌ Invalid file path: ${filename}`);
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Delete from local filesystem
    // Use local generated folder for development, /tmp/generated for production
    const generatedDir = process.env.NODE_ENV === 'production' 
      ? path.join("/tmp/generated", projectId)
      : path.join(process.cwd(), "generated", projectId);
    const localFilePath = path.join(generatedDir, filename);

    try {
      if (await fs.pathExists(localFilePath)) {
        await fs.remove(localFilePath);
        logger.log(`✅ File deleted locally: ${localFilePath}`);
      }
    } catch (error) {
      logger.warn(`⚠️ Failed to delete file locally:`, error);
    }

    // Delete from preview
    try {
      await deleteGeneratedFile(projectId, filename);
      logger.log(`✅ Generated file deleted: ${filename}`);

      return NextResponse.json({
        success: true,
        filename,
        projectId,
        message: "File deleted successfully",
      });
    } catch (error) {
      logger.error(`❌ Failed to delete generated file:`, error);
      return NextResponse.json(
        { error: "Failed to delete generated file" },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error("❌ Error deleting file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}
