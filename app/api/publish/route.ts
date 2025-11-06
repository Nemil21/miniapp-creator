import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from 'next/server';
import { updateGeneratedFile } from '../../../lib/previewManager';
import { db, projects } from '../../../db';
import { eq } from 'drizzle-orm';
import { getUserBySessionToken } from '../../../lib/database';
import { config } from '../../../lib/config';
import fs from 'fs/promises';
import path from 'path';
  
// Validate manifest structure
function validateManifest(manifest: unknown): { valid: boolean; error?: string } {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Manifest must be an object' };
  }

  const manifestObj = manifest as Record<string, unknown>;

  // Check for either miniapp or frame field
  if (!manifestObj.miniapp && !manifestObj.frame) { 
    return { valid: false, error: 'Manifest must contain either "miniapp" or "frame" field' };
  }

  // Validate accountAssociation structure if it exists and is not null
  // accountAssociation can be null for direct publishing without Farcaster wallet signature
  if ('accountAssociation' in manifestObj && manifestObj.accountAssociation !== null) {
    const accountAssociation = manifestObj.accountAssociation as Record<string, unknown>;
    // Only validate if accountAssociation is provided and not explicitly null
    if (accountAssociation.header !== null || accountAssociation.payload !== null || accountAssociation.signature !== null) {
      // If any field is provided, all must be provided
      if (!accountAssociation.header || !accountAssociation.payload || !accountAssociation.signature) {
        return { valid: false, error: 'accountAssociation must contain header, payload, and signature (or be null for direct publishing)' };
      }
    }
  }

  // Validate miniapp required fields if present
  if (manifestObj.miniapp) {
    const miniapp = manifestObj.miniapp as Record<string, unknown>;
    const requiredFields = ['version', 'name', 'iconUrl', 'homeUrl'];

    for (const field of requiredFields) {
      if (!miniapp[field]) {
        return { valid: false, error: `Missing required field in miniapp: ${field}` };
      }
    }
  }

  // Validate frame required fields if present
  if (manifestObj.frame) {
    const frame = manifestObj.frame as Record<string, unknown>;
    const requiredFields = ['version', 'name', 'iconUrl', 'homeUrl'];

    for (const field of requiredFields) {
      if (!frame[field]) {
        return { valid: false, error: `Missing required field in frame: ${field}` };
      }
    }
  }

  return { valid: true };
}

// POST: Publish manifest
export async function POST(req: NextRequest) {
  try {
    logger.log('\n========================================');
    logger.log('📤 PUBLISH API REQUEST RECEIVED');
    logger.log('========================================');

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
      logger.log('✅ Request body parsed successfully');
    } catch (parseError) {
      logger.error('❌ Failed to parse request body:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { projectId, manifest } = requestBody;
    logger.log('📦 Request data:', {
      projectId,
      hasManifest: !!manifest,
      manifestKeys: manifest ? Object.keys(manifest) : []
    });

    // Validate required fields
    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'Missing projectId' },
        { status: 400 }
      );
    }

    if (!manifest) {
      return NextResponse.json(
        { success: false, error: 'Missing manifest' },
        { status: 400 }
      );
    }

    // Verify session token
    const authHeader = req.headers.get('authorization');
    const sessionToken = authHeader?.replace('Bearer ', '');

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    // Verify session token and get user
    const user = await getUserBySessionToken(sessionToken);

    if (!user) {
      logger.error('❌ Session verification failed: Invalid or expired token');
      return NextResponse.json(
        { success: false, error: 'Invalid or expired session' },
        { status: 401 }
      );
    }

    // Check if session is expired
    if (user.expiresAt && new Date() > new Date(user.expiresAt)) {
      logger.error('❌ Session expired');
      return NextResponse.json(
        { success: false, error: 'Session expired' },
        { status: 401 }
      );
    }

    const userId = user.id;
    logger.log('✅ Session verified for user:', userId);

    // Validate manifest structure
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      logger.error('❌ Manifest validation failed:', validation.error);
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    logger.log('✅ Manifest validation passed');

    // Check if project exists and belongs to user
    const projectRecords = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (projectRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const project = projectRecords[0];

    if (project.userId !== userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Project does not belong to user' },
        { status: 403 }
      );
    }

    logger.log('✅ Project ownership verified');

    // Create farcaster.json content
    const farcasterJsonContent = JSON.stringify(manifest, null, 2);
    const filename = 'public/.well-known/farcaster.json';

    // Update file in generated directory
    try {
      await updateGeneratedFile(projectId, filename, farcasterJsonContent);
      logger.log('✅ File saved to generated directory:', filename);
    } catch (error) {
      logger.error('❌ Failed to save file locally:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error details:', errorMessage);
      // Continue anyway - file will be created in preview update
    }

    // Update database
    try {
      await db
        .update(projects)
        .set({
          farcasterManifest: manifest,
          publishedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      logger.log('✅ Database updated with manifest');
    } catch (error) {
      logger.error('❌ Failed to update database:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to save manifest to database' },
        { status: 500 }
      );
    }

    // Trigger FULL redeploy to Vercel with the manifest file
    try {
      // Use PREVIEW_AUTH_TOKEN instead of user session token for preview host authentication
      const previewAuthToken = config.preview.authToken;
      if (!previewAuthToken) {
        logger.warn('⚠️ PREVIEW_AUTH_TOKEN not configured, skipping preview update');
      } else {
        logger.log('🚀 Triggering full Vercel redeploy with manifest file...');
        
        // Read all project files to include in redeploy
        const outputDir = process.env.NODE_ENV === 'production' 
          ? '/tmp/generated' 
          : path.join(process.cwd(), 'generated');
        const projectDir = path.join(outputDir, projectId);
        const allFiles: { filename: string; content: string }[] = [];
        
        async function readDir(dir: string, baseDir: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);
            
            // Skip certain directories
            if (
              entry.name === 'node_modules' ||
              entry.name === '.next' ||
              entry.name === '.vercel' ||
              entry.name === 'dist' ||
              entry.name === 'build' ||
              entry.name === '.git'
            ) {
              continue;
            }
            
            if (entry.isDirectory()) {
              await readDir(fullPath, baseDir);
            } else {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                allFiles.push({ filename: relativePath, content });
              } catch (readError) {
                logger.warn(`⚠️ Failed to read file ${relativePath}:`, readError);
              }
            }
          }
        }
        
        await readDir(projectDir, projectDir);
        logger.log(`📦 Read ${allFiles.length} files for Vercel redeploy`);
        
        // Convert files to object format for direct API call
        const filesObject: { [key: string]: string } = {};
        allFiles.forEach((file) => {
          filesObject[file.filename] = file.content;
        });
        
        // Make direct API call to /deploy endpoint to force fresh Vercel deployment
        const previewApiBase = config.preview.apiBase;
        // Ensure URL has protocol
        const baseUrl = previewApiBase.startsWith('http') 
          ? previewApiBase 
          : `http://${previewApiBase}`;
        const deployUrl = `${baseUrl}/deploy`;
        
        logger.log(`📤 Triggering fresh Vercel deployment to: ${deployUrl}`);
        
        const deployResponse = await fetch(deployUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${previewAuthToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            hash: projectId,
            files: filesObject,
            deployToExternal: 'vercel',
            isWeb3: true,
            skipContracts: true, // Contracts already deployed
            wait: false, // Don't wait for completion
          }),
        });
        
        if (!deployResponse.ok) {
          const errorText = await deployResponse.text();
          throw new Error(`Vercel deployment failed: ${deployResponse.status} ${errorText}`);
        }
        
        const previewResponse = await deployResponse.json();
        
        logger.log('✅ Vercel redeploy triggered successfully');
        logger.log(`🌐 Vercel URL: ${previewResponse.vercelUrl || previewResponse.previewUrl}`);
        
        // Update the project record with the latest Vercel URL
        if (previewResponse.vercelUrl) {
          await db
            .update(projects)
            .set({ 
              vercelUrl: previewResponse.vercelUrl,
              previewUrl: previewResponse.vercelUrl 
            })
            .where(eq(projects.id, project.id));
        }
      }
    } catch (error) {
      logger.error('❌ Failed to trigger Vercel redeploy:', error);
      // Don't fail the request - continue with local manifest
    }

    // Build manifest URL
    const projectUrl = project.previewUrl || project.vercelUrl || `http://localhost:3000`;
    const manifestUrl = `${projectUrl}/.well-known/farcaster.json`;

    logger.log('✅ Publish successful:', { projectId, manifestUrl });

    return NextResponse.json({
      success: true,
      manifestUrl,
      projectId,
      message: 'Manifest published successfully'
    });

  } catch (error) {
    logger.error('❌ Publish error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to publish manifest'
      },
      { status: 500 }
    );
  }
}
