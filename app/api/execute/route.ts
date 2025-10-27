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
    console.log('\n========================================');
    console.log('🔧 EXECUTE API REQUEST RECEIVED');
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
    console.log('✅ User authenticated:', user.privyUserId);

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

    const { projectId, command, args, workingDirectory } = requestBody;

    console.log('📦 Request data:', {
      projectId,
      command,
      argsCount: args?.length || 0,
      workingDirectory: workingDirectory || 'default'
    });

    // 3. Validate required fields
    if (!projectId) {
      console.error('❌ Validation failed: Missing projectId');
      return NextResponse.json(
        { success: false, error: 'Missing required field: projectId' },
        { status: 400 }
      );
    }

    if (!command) {
      console.error('❌ Validation failed: Missing command');
      return NextResponse.json(
        { success: false, error: 'Missing required field: command' },
        { status: 400 }
      );
    }

    // 4. Get preview host configuration
    const previewApiBase = process.env.PREVIEW_API_BASE;
    const previewAuthToken = process.env.PREVIEW_AUTH_TOKEN;

    if (!previewApiBase) {
      console.error('❌ Configuration error: PREVIEW_API_BASE not set');
      return NextResponse.json(
        { success: false, error: 'Preview host not configured' },
        { status: 500 }
      );
    }

    if (!previewAuthToken) {
      console.error('❌ Configuration error: PREVIEW_AUTH_TOKEN not set');
      return NextResponse.json(
        { success: false, error: 'Preview authentication not configured' },
        { status: 500 }
      );
    }

    console.log('🔗 Forwarding to preview host:', `${previewApiBase}/previews/${projectId}/execute`);

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

      console.log('✅ Preview host response status:', response.status);

    } catch (fetchError) {
      console.error('❌ Failed to connect to preview host:', fetchError);
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
      console.log('✅ Preview host response parsed:', {
        success: result.success,
        hasOutput: !!result.output
      });
    } catch (parseError) {
      console.error('❌ Failed to parse preview host response:', parseError);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid response from preview host'
        },
        { status: 502 }
      );
    }

    // 7. Return result
    console.log('✅ Execute request completed successfully');
    console.log('========================================\n');
    
    return NextResponse.json(result, { status: response.status });

  } catch (error) {
    console.error('❌ Execute API error:', error);
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

