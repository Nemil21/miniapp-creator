import { logger } from "../../../lib/logger";
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../lib/auth';

/**
 * POST /api/execute
 * Execute safe commands in the project directory via preview host
 * 
 * This endpoint proxies tool execution requests to the preview host,
 * which runs commands like grep, find, cat, tree, etc. in a safe,
 * sandboxed environment.
 * 
 * Used by the LLM during Stage 0 (Context Gathering) to inspect
 * project files and understand the codebase.
 */
export async function POST(req: NextRequest) {
  try {
    logger.log('\n========================================');
    logger.log('🔧 EXECUTE API REQUEST RECEIVED');
    logger.log('========================================');

    // 1. Authenticate request
    const authResult = await authenticateRequest(req);
    if (!authResult.isAuthorized || !authResult.user) {
      logger.error('❌ Authentication failed:', authResult.error || 'No valid session');
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = authResult.user;
    logger.log('✅ User authenticated:', user.privyUserId);

    // 2. Parse request body
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

    const { projectId, command, args, workingDirectory } = requestBody;

    logger.log('📦 Request data:', {
      projectId,
      command,
      argsCount: args?.length || 0,
      workingDirectory: workingDirectory || 'default'
    });

    // 3. Validate required fields
    if (!projectId) {
      logger.error('❌ Validation failed: Missing projectId');
      return NextResponse.json(
        { success: false, error: 'Missing required field: projectId' },
        { status: 400 }
      );
    }

    if (!command) {
      logger.error('❌ Validation failed: Missing command');
      return NextResponse.json(
        { success: false, error: 'Missing required field: command' },
        { status: 400 }
      );
    }

    // 4. Get preview host configuration
    const previewApiBase = process.env.PREVIEW_API_BASE;
    const previewAuthToken = process.env.PREVIEW_AUTH_TOKEN;

    if (!previewApiBase) {
      logger.error('❌ Configuration error: PREVIEW_API_BASE not set');
      return NextResponse.json(
        { success: false, error: 'Preview host not configured' },
        { status: 500 }
      );
    }

    if (!previewAuthToken) {
      logger.error('❌ Configuration error: PREVIEW_AUTH_TOKEN not set');
      return NextResponse.json(
        { success: false, error: 'Preview authentication not configured' },
        { status: 500 }
      );
    }

    logger.log('🔗 Forwarding to preview host:', `${previewApiBase}/previews/${projectId}/execute`);

    // 5. Forward request to preview host
    const previewUrl = `${previewApiBase}/previews/${projectId}/execute`;
    
    let response;
    try {
      response = await fetch(previewUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${previewAuthToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command,
          args: args || [],
          workingDirectory,
        }),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      logger.log('✅ Preview host response status:', response.status);

    } catch (fetchError) {
      logger.error('❌ Failed to connect to preview host:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to connect to preview host',
          details: fetchError instanceof Error ? fetchError.message : 'Unknown error'
        },
        { status: 503 }
      );
    }

    // 6. Parse response
    let result;
    try {
      result = await response.json();
      logger.log('✅ Preview host response parsed:', {
        success: result.success,
        hasOutput: !!result.output
      });
    } catch (parseError) {
      logger.error('❌ Failed to parse preview host response:', parseError);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid response from preview host'
        },
        { status: 502 }
      );
    }

    // 7. Return result
    logger.log('✅ Execute request completed successfully');
    logger.log('========================================\n');
    
    return NextResponse.json(result, { status: response.status });

  } catch (error) {
    logger.error('❌ Execute API error:', error);
    logger.log('========================================\n');
    
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
 * GET /api/execute
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/execute',
    description: 'Execute safe commands in project directory via preview host',
    methods: ['POST'],
    requiredFields: ['projectId', 'command'],
    optionalFields: ['args', 'workingDirectory'],
    allowedCommands: ['grep', 'find', 'tree', 'cat', 'head', 'tail', 'wc', 'ls', 'pwd', 'file', 'which', 'type', 'dirname', 'basename', 'realpath'],
  });
}

