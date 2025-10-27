import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../lib/auth';
import { db, projects, projectDeployments } from '../../../db';
import { eq } from 'drizzle-orm';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

/**
 * POST /api/build
 * Trigger build and collect logs
 * 
 * This endpoint:
 * 1. Validates user owns the project
 * 2. Runs `npm run build` in the project directory
 * 3. Captures stdout/stderr
 * 4. Stores deployment info in database
 * 5. Returns build status and logs
 */
export async function POST(req: NextRequest) {
  try {
    console.log('\n========================================');
    console.log('🔨 BUILD API REQUEST RECEIVED');
    console.log('========================================');

    // 1. Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.isAuthorized || !authResult.user) {
      console.error('❌ Authentication failed:', authResult.error || 'No valid session');
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = authResult.user;
    console.log('✅ User authenticated:', user.id);

    // 2. Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
      console.log('✅ Request body parsed successfully');
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { projectId } = requestBody;

    console.log('📦 Request data:', { projectId });

    // 3. Validate projectId
    if (!projectId) {
      console.error('❌ Validation failed: Missing projectId');
      return NextResponse.json(
        { success: false, error: 'Missing required field: projectId' },
        { status: 400 }
      );
    }

    // 4. Check if project exists and belongs to user
    const projectRecords = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (projectRecords.length === 0) {
      console.error('❌ Project not found:', projectId);
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const project = projectRecords[0];

    if (project.userId !== user.id) {
      console.error('❌ Unauthorized: Project does not belong to user');
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Project does not belong to user' },
        { status: 403 }
      );
    }

    console.log('✅ Project ownership verified');

    // 5. Get project directory
    const projectDir = path.join(process.cwd(), 'generated', projectId);

    // Check if directory exists
    if (!await fs.pathExists(projectDir)) {
      console.error('❌ Project directory not found:', projectDir);
      return NextResponse.json(
        { success: false, error: 'Project directory not found' },
        { status: 404 }
      );
    }

    console.log('📂 Project directory:', projectDir);

    // 6. Run build
    console.log('🔨 Starting build process...');
    
    const buildResult = await runBuild(projectDir);

    console.log('✅ Build process completed:', {
      success: buildResult.success,
      exitCode: buildResult.exitCode,
      duration: buildResult.executionTime
    });

    // 7. Save deployment info to database
    if (buildResult.success) {
      try {
        await db.insert(projectDeployments).values({
          projectId,
          platform: 'local',
          deploymentUrl: project.previewUrl || 'http://localhost:3000',
          status: 'success',
          buildLogs: buildResult.output,
          deployedAt: new Date(),
        });
        console.log('✅ Deployment info saved to database');
      } catch (dbError) {
        console.warn('⚠️ Failed to save deployment info:', dbError);
        // Don't fail the request if DB save fails
      }
    }

    // 8. Return result
    console.log('✅ Build request completed');
    console.log('========================================\n');

    return NextResponse.json({
      success: buildResult.success,
      status: buildResult.success ? 'completed' : 'failed',
      logs: buildResult.output,
      errors: buildResult.error ? [buildResult.error] : [],
      exitCode: buildResult.exitCode,
      executionTime: buildResult.executionTime,
    });

  } catch (error) {
    console.error('❌ Build API error:', error);
    console.log('========================================\n');
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Run npm build command in project directory
 */
async function runBuild(projectDir: string): Promise<{
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  executionTime: number;
}> {
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    // Use npm to run the build script
    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: projectDir,
      shell: true,
      env: { ...process.env }
    });

    // Capture stdout
    buildProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log('[BUILD]', chunk.trim());
    });

    // Capture stderr
    buildProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.error('[BUILD ERROR]', chunk.trim());
    });

    // Handle completion
    buildProcess.on('close', (code) => {
      const executionTime = Date.now() - startTime;
      
      const output = stdout + (stderr ? `\n\nErrors:\n${stderr}` : '');
      
      resolve({
        success: code === 0,
        output: output.slice(0, 50000), // Limit to 50KB
        error: code !== 0 ? stderr : undefined,
        exitCode: code || 0,
        executionTime
      });
    });

    // Handle errors
    buildProcess.on('error', (error) => {
      const executionTime = Date.now() - startTime;
      
      resolve({
        success: false,
        output: stdout,
        error: error.message,
        exitCode: -1,
        executionTime
      });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (!buildProcess.killed) {
        buildProcess.kill();
        resolve({
          success: false,
          output: stdout,
          error: 'Build timeout (exceeded 2 minutes)',
          exitCode: -1,
          executionTime: 120000
        });
      }
    }, 120000);
  });
}

/**
 * GET /api/build
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/build',
    description: 'Trigger build and collect logs',
    methods: ['POST'],
    requiredFields: ['projectId'],
    timeout: '120 seconds',
  });
}


