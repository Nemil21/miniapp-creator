import { logger } from "./logger";
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

// Security configuration
const ALLOWED_COMMANDS = new Set([
  'grep', 'find', 'tree', 'cat', 'head', 'tail', 'wc', 'ls', 'pwd',
  'file', 'which', 'type', 'dirname', 'basename', 'realpath'
]);

const MAX_OUTPUT_LENGTH = 10000; // 10KB limit
const MAX_EXECUTION_TIME = 5000; // 5 seconds
const MAX_ARGS = 10;

export interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  executionTime: number;
}

export interface CommandRequest {
  command: string;
  args: string[];
  workingDirectory: string;
  timeout?: number;
}

export class SecureCommandExecutor {
  private projectId: string;
  private baseDir: string;

  constructor(projectId: string, baseDir: string) {
    this.projectId = projectId;
    this.baseDir = baseDir;
  }

  /**
   * Execute a command safely with security checks
   */
  async executeCommand(request: CommandRequest): Promise<CommandResult> {
    const startTime = Date.now();
    
    try {
      // Security validations
      this.validateCommand(request);
      this.validateWorkingDirectory(request.workingDirectory);
      
      // Execute command
      const result = await this.runCommand(request);
      
      return {
        success: result.exitCode === 0,
        output: result.output,
        error: result.error,
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate command and arguments for security
   */
  private validateCommand(request: CommandRequest): void {
    // Check if command is allowed
    if (!ALLOWED_COMMANDS.has(request.command)) {
      throw new Error(`Command '${request.command}' is not allowed`);
    }

    // Check argument count
    if (request.args.length > MAX_ARGS) {
      throw new Error(`Too many arguments: ${request.args.length} > ${MAX_ARGS}`);
    }

    // Validate arguments for security
    for (const arg of request.args) {
      if (this.containsDangerousPatterns(arg)) {
        throw new Error(`Dangerous pattern detected in argument: ${arg}`);
      }
    }
  }

  /**
   * Check for dangerous patterns in arguments
   */
  private containsDangerousPatterns(arg: string): boolean {
    const dangerousPatterns = [
      /[;&|`$]/,           // Command chaining
      /\.\./,              // Directory traversal
      /\/etc\/|\/proc\/|\/sys\//, // System directories
      /rm\s|del\s|mv\s|cp\s/,     // File operations
      /wget|curl|nc\s|netcat/,    // Network operations
      /eval|exec|system/,         // Code execution
      />/g, /</g, /&/g,           // Redirection and background
    ];

    return dangerousPatterns.some(pattern => pattern.test(arg));
  }

  /**
   * Validate working directory is within project bounds
   */
  private validateWorkingDirectory(workingDir: string): void {
    const resolvedPath = path.resolve(this.baseDir, workingDir);
    const basePath = path.resolve(this.baseDir);
    
    if (!resolvedPath.startsWith(basePath)) {
      throw new Error('Working directory outside project bounds');
    }

    // For relative paths like 'src', check if the base directory exists
    // and allow execution even if the specific subdirectory doesn't exist yet
    if (!fs.existsSync(basePath)) {
      throw new Error('Project base directory does not exist');
    }
    
    // Only check specific directory existence for absolute paths or if it's not a common relative path
    if (workingDir !== '.' && !workingDir.startsWith('./') && !['src', 'app', 'components', 'lib', 'public'].includes(workingDir)) {
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Working directory does not exist: ${workingDir}`);
      }
    }
  }

  /**
   * Execute the command with timeout and output limits
   */
  private async runCommand(request: CommandRequest): Promise<{
    output: string;
    error: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = request.timeout || MAX_EXECUTION_TIME;
      const workingDir = path.resolve(this.baseDir, request.workingDirectory);
      
      const child = spawn(request.command, request.args, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeout,
        shell: false // Prevent shell injection
      });

      let output = '';
      let error = '';

      child.stdout?.on('data', (data) => {
        output += data.toString();
        // Truncate output if too long
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)';
          child.kill('SIGTERM');
        }
      });

      child.stderr?.on('data', (data) => {
        error += data.toString();
        // Truncate error if too long
        if (error.length > MAX_OUTPUT_LENGTH) {
          error = error.substring(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)';
          child.kill('SIGTERM');
        }
      });

      child.on('close', (code) => {
        resolve({
          output: output.trim(),
          error: error.trim(),
          exitCode: code || 0
        });
      });

      child.on('error', (err) => {
        reject(new Error(`Command execution failed: ${err.message}`));
      });

      // Timeout handling
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }
      }, timeout);
    });
  }
}

/**
 * Parse tool call from LLM response
 */
export function parseToolCall(response: string): CommandRequest | null {
  try {
    // Look for JSON tool call in response
    const toolCallMatch = response.match(/\{[\s\S]*"tool":\s*"[^"]+"[\s\S]*\}/);
    if (!toolCallMatch) return null;

    const toolCall = JSON.parse(toolCallMatch[0]);
    
    if (!toolCall.tool || !toolCall.args) return null;

    return {
      command: toolCall.tool,
      args: Array.isArray(toolCall.args) ? toolCall.args : [toolCall.args],
      workingDirectory: toolCall.workingDirectory || '.',
      timeout: toolCall.timeout
    };
  } catch (error) {
    logger.warn('Failed to parse tool call:', error);
    return null;
  }
}

/**
 * Format command result for LLM consumption
 */
export function formatCommandResult(result: CommandResult, command: string): string {
  if (!result.success) {
    return `Command '${command}' failed (exit code: ${result.exitCode}):\n${result.error}`;
  }

  return `Command '${command}' completed successfully:\n${result.output}`;
}
