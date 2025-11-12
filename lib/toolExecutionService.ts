import { clsx, type ClassValue } from "clsx";
import * as fs from 'fs';
import * as path from 'path';
import { twMerge } from "tailwind-merge";
import { SecureCommandExecutor, formatCommandResult } from './commandExecutor';
import { ContextGatheringResult, STAGE_MODEL_CONFIG } from './llmOptimizer';
import { logger } from "./logger";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL}${path}`
}


// Debug logging utilities
const createDebugLogDir = (projectId: string): string => {
  const debugDir = path.join(process.cwd(), 'debug-logs', projectId);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  return debugDir;
};

const logStageResponse = (projectId: string, stageName: string, response: string, metadata?: Record<string, unknown>): void => {
  try {
    const logContent = {
      timestamp: new Date().toISOString(),
      stage: stageName,
      projectId,
      metadata,
      responseLength: response.length,
      response: response
    };
    
    // In production (Vercel), use structured console logging instead of file system
    if (process.env.NODE_ENV === 'production') {
      logger.log(`[${stageName}] ${JSON.stringify(logContent)}`);
    } else {
      // In development, still write to files
      const debugDir = createDebugLogDir(projectId);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${stageName}-${timestamp}.log`;
      const filepath = path.join(debugDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(logContent, null, 2));
      logger.log(`📝 Debug log saved: ${filepath}`);
    }
  } catch (error) {
    logger.error('Failed to write debug log:', error);
  }
};

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
}

export interface ContextExecutionResult {
  success: boolean;
  contextData: string;
  toolResults: ToolExecutionResult[];
  error?: string;
}

/**
 * Execute tool calls from context gathering result
 */
export async function executeToolCalls(
  contextResult: ContextGatheringResult,
  projectId: string,
  projectDir: string
): Promise<ContextExecutionResult> {
  if (!contextResult.needsContext || !contextResult.toolCalls?.length) {
    return {
      success: true,
      contextData: '',
      toolResults: []
    };
  }

  const executor = new SecureCommandExecutor(projectId, projectDir);
  const toolResults: ToolExecutionResult[] = [];
  let contextData = '';

  logger.log(`🔧 Executing ${contextResult.toolCalls.length} tool calls for context gathering`);

  for (const toolCall of contextResult.toolCalls) {
    try {
      logger.log(`🔧 Executing: ${toolCall.tool} ${toolCall.args.join(' ')}`);
      
      // Fix working directory and args for common tools
      let fixedToolCall = { ...toolCall };
      
      // Fix common path issues for specific tools
      if (toolCall.args.length > 0) {
        const workingDir = toolCall.workingDirectory || '.';
        
        // Handle different tools with specific path resolution logic
        let fixedArgs = [...toolCall.args];
        
        if (toolCall.tool === 'grep') {
          // For grep: pattern, files/directories
          // Don't modify the pattern (first arg), only file paths (remaining args)
          if (fixedArgs.length > 1) {
            fixedArgs = [
              fixedArgs[0], // Keep pattern as-is
              ...fixedArgs.slice(1).map(arg => {
                // For grep targets, handle directory vs file paths differently
                if (arg === workingDir) {
                  // If searching entire working directory, use '.'
                  return '.';
                } else if (arg.startsWith(workingDir + '/')) {
                  // If it's a file within working directory, make it relative
                  return arg.substring(workingDir.length + 1);
                } else {
                  // Otherwise keep as-is (might be absolute or already relative)
                  return arg;
                }
              })
            ];
          }
        } else if (['cat', 'head', 'tail', 'wc'].includes(toolCall.tool)) {
          // For file reading tools: only fix file paths
          fixedArgs = toolCall.args.map(arg => {
            if (arg.startsWith(workingDir + '/')) {
              return arg.substring(workingDir.length + 1);
            }
            return arg;
          });
        } else if (['find', 'ls', 'tree'].includes(toolCall.tool)) {
          // For directory listing tools: handle directory paths
          fixedArgs = toolCall.args.map(arg => {
            if (arg === workingDir) {
              return '.';
            } else if (arg.startsWith(workingDir + '/')) {
              return arg.substring(workingDir.length + 1);
            }
            return arg;
          });
        }
        // For unknown tools, don't modify args to avoid breaking them
        
        // Apply fixes if any changes were made
        if (JSON.stringify(fixedArgs) !== JSON.stringify(toolCall.args)) {
          fixedToolCall = {
            ...toolCall,
            args: fixedArgs
          };
          logger.log(`🔧 Fixed ${toolCall.tool} command: ${fixedToolCall.args.join(' ')} (was: ${toolCall.args.join(' ')})`);
        }
      }
      
      const result = await executor.executeCommand({
        command: fixedToolCall.tool,
        args: fixedToolCall.args,
        workingDirectory: fixedToolCall.workingDirectory || '.'
      });

      const toolResult: ToolExecutionResult = {
        success: result.success,
        output: result.output,
        error: result.error,
        executionTime: result.executionTime
      };

      toolResults.push(toolResult);

      if (result.success) {
        const formattedOutput = formatCommandResult(result, toolCall.tool);
        contextData += `\n\n## ${toolCall.tool} ${toolCall.args.join(' ')}\n${formattedOutput}`;
      } else {
        logger.warn(`⚠️ Tool call failed: ${toolCall.tool}`, result.error);
        contextData += `\n\n## ${toolCall.tool} ${toolCall.args.join(' ')} (FAILED)\n${result.error}`;
      }

    } catch (error) {
      logger.error(`❌ Tool execution error:`, error);
      const toolResult: ToolExecutionResult = {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        executionTime: 0
      };
      toolResults.push(toolResult);
    }
  }

  return {
    success: toolResults.some(r => r.success),
    contextData: contextData.trim(),
    toolResults
  };
}

/**
 * Execute tool calls via preview host API
 */
export async function executeToolCallsViaAPI(
  contextResult: ContextGatheringResult,
  projectId: string,
  accessToken: string,
  previewApiBase: string = process.env.PREVIEW_API_BASE || 'https://minidev.fun'
): Promise<ContextExecutionResult> {
  if (!contextResult.needsContext || !contextResult.toolCalls?.length) {
    return {
      success: true,
      contextData: '',
      toolResults: []
    };
  }

  const toolResults: ToolExecutionResult[] = [];
  let contextData = '';

  logger.log(`🔧 Executing ${contextResult.toolCalls.length} tool calls via API`);

  for (const toolCall of contextResult.toolCalls) {
    try {
      logger.log(`🔧 Executing via API: ${toolCall.tool} ${toolCall.args.join(' ')}`);
      
      const response = await fetch(`${previewApiBase}/previews/${projectId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: toolCall.tool,
          args: toolCall.args,
          workingDirectory: toolCall.workingDirectory || '.'
        })
      });

      const result = await response.json();

      const toolResult: ToolExecutionResult = {
        success: result.success,
        output: result.output || '',
        error: result.error,
        executionTime: result.executionTime || 0
      };

      toolResults.push(toolResult);

      if (result.success) {
        const formattedOutput = formatCommandResult({
          success: true,
          output: result.output || '',
          exitCode: 0,
          executionTime: result.executionTime || 0
        }, toolCall.tool);
        contextData += `\n\n## ${toolCall.tool} ${toolCall.args.join(' ')}\n${formattedOutput}`;
      } else {
        logger.warn(`⚠️ Tool call failed: ${toolCall.tool}`, result.error);
        contextData += `\n\n## ${toolCall.tool} ${toolCall.args.join(' ')} (FAILED)\n${result.error}`;
      }

    } catch (error) {
      logger.error(`❌ Tool execution error:`, error);
      const toolResult: ToolExecutionResult = {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        executionTime: 0
      };
      toolResults.push(toolResult);
    }
  }

  return {
    success: toolResults.some(r => r.success),
    contextData: contextData.trim(),
    toolResults
  };
}

/**
 * Enhanced context gathering with tool execution
 */
export async function gatherContextWithTools(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  projectId: string,
  accessToken: string,
  callLLM: (systemPrompt: string, userPrompt: string, stageName: string, stageType?: keyof typeof STAGE_MODEL_CONFIG) => Promise<string>,
  projectDir?: string
): Promise<{
  contextResult: ContextGatheringResult;
  contextData: string;
  enhancedFiles: { filename: string; content: string }[];
}> {
  // First, determine if context is needed
  const contextPrompt = `USER REQUEST: ${userPrompt}`;
  const contextResponse = await callLLM(
    `ROLE: Context Gatherer for Farcaster Miniapp

TASK: Analyze if additional context is needed before processing the user request.

USER REQUEST: ${userPrompt}

CURRENT FILES AVAILABLE:
${currentFiles.map(f => `- ${f.filename}`).join('\n')}

AVAILABLE TOOLS:
- grep: Search for patterns in files (use simple patterns, avoid | & ; characters)
- find: Find files by name or type
- tree: Show directory structure
- cat: Read file contents

SECURITY NOTE: Avoid using | & ; characters in grep patterns. Use separate grep calls instead.

CRITICAL: Return ONLY valid JSON.

OUTPUT FORMAT:
{
  "needsContext": boolean,
  "toolCalls": [{"tool": "grep", "args": ["pattern", "src"], "workingDirectory": "src", "reason": "..."}],
  "contextSummary": "Brief summary"
}

Return ONLY the JSON object.`,
    contextPrompt,
    "Context Gatherer",
    "STAGE_0_CONTEXT_GATHERER"
  );
  
  // Log context gathering response for debugging
  logStageResponse(projectId, 'stage0-context-gatherer', contextResponse, {
    userPromptLength: contextPrompt.length,
    currentFilesCount: currentFiles.length
  });

  let contextResult: ContextGatheringResult;
  try {
    // First try to parse the response directly
    contextResult = JSON.parse(contextResponse);
  } catch (error) {
    logger.error('Failed to parse context gathering result:', error);
    logger.error('Raw response:', contextResponse.substring(0, 500));
    
    // Fallback: try to extract and clean JSON from the response
    try {
      const jsonStart = contextResponse.indexOf('{');
      const jsonEnd = contextResponse.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        let jsonContent = contextResponse.substring(jsonStart, jsonEnd + 1);
        
        // Clean up common JSON issues
        jsonContent = jsonContent
          .replace(/\n/g, '\\n')  // Escape newlines
          .replace(/\r/g, '\\r')  // Escape carriage returns
          .replace(/\t/g, '\\t')  // Escape tabs
          .replace(/\f/g, '\\f')  // Escape form feeds
          .replace(/\b/g, '\\b')  // Escape backspaces
          .replace(/\v/g, '\\v'); // Escape vertical tabs
        
        contextResult = JSON.parse(jsonContent);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (fallbackError) {
      logger.error('Fallback parsing also failed:', fallbackError);
      return {
        contextResult: { needsContext: false, toolCalls: [] },
        contextData: '',
        enhancedFiles: currentFiles
      };
    }
  }

  if (!contextResult.needsContext) {
    return {
      contextResult,
      contextData: '',
      enhancedFiles: currentFiles
    };
  }

  // Execute tool calls
  let executionResult: ContextExecutionResult;
  
  if (projectDir) {
    // Use local tool execution when project directory is available
    logger.log(`🔧 Using local tool execution with project directory: ${projectDir}`);
    executionResult = await executeToolCalls(contextResult, projectId, projectDir);
  } else {
    // Fallback to API execution when project directory is not available
    logger.log(`🔧 Using API tool execution (no project directory provided)`);
    executionResult = await executeToolCallsViaAPI(contextResult, projectId, accessToken);
  }

  // Enhance current files with context data
  const enhancedFiles = [...currentFiles];
  if (executionResult.contextData) {
    enhancedFiles.push({
      filename: '_context.md',
      content: `# Context Gathered\n\n${executionResult.contextData}`
    });
  }

  return {
    contextResult,
    contextData: executionResult.contextData,
    enhancedFiles
  };
}
