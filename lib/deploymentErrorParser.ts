/**
 * Parse deployment errors from Vercel/Railway build logs
 * and convert them into actionable error messages for the LLM
 */

export interface DeploymentError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  category: 'typescript' | 'eslint' | 'build' | 'runtime';
  code?: string;
  context?: string;
}

export interface ParsedDeploymentErrors {
  errors: DeploymentError[];
  hasTypeScriptErrors: boolean;
  hasESLintErrors: boolean;
  hasBuildErrors: boolean;
  summary: string;
}

/**
 * Parse Vercel deployment error logs
 */
export function parseVercelDeploymentErrors(
  errorOutput: string,
  logs: string
): ParsedDeploymentErrors {
  const errors: DeploymentError[] = [];
  const allLogs = `${errorOutput}\n${logs}`;

  // Parse TypeScript errors
  // Format: ./src/app/page.tsx:158:11
  // Type error: Type 'number[][]' is not assignable to type ...
  const tsErrorRegex = /\.\/([^:]+):(\d+):(\d+)\s*\n\s*Type error:\s*([^\n]+)/g;
  let match;

  while ((match = tsErrorRegex.exec(allLogs)) !== null) {
    const [, file, line, column, message] = match;
    errors.push({
      file: file.trim(),
      line: parseInt(line),
      column: parseInt(column),
      message: `TypeScript: ${message.trim()}`,
      severity: 'error',
      category: 'typescript',
      code: 'TS_ERROR',
    });
  }

  // Parse ESLint configuration errors
  // Format: ESLint: Invalid Options: - Unknown options: useEslintrc, extensions
  const eslintConfigRegex = /ESLint:\s*Invalid Options:\s*([^\n]+)/g;
  while ((match = eslintConfigRegex.exec(allLogs)) !== null) {
    const [, message] = match;
    errors.push({
      message: `ESLint Config: ${message.trim()}`,
      severity: 'error',
      category: 'eslint',
      code: 'ESLINT_CONFIG',
    });
  }

  // Parse general ESLint errors
  // Format: ESLint: 7:5 - Error: 'variable' is assigned a value but never used. (@typescript-eslint/no-unused-vars)
  const eslintErrorRegex = /ESLint:\s*(\d+):(\d+)\s*-\s*(Error|Warning):\s*(.+?)\s*\(([^)]+)\)/g;
  while ((match = eslintErrorRegex.exec(allLogs)) !== null) {
    const [, line, column, severity, message, rule] = match;
    errors.push({
      line: parseInt(line),
      column: parseInt(column),
      message: `${message.trim()} (${rule})`,
      severity: severity.toLowerCase() === 'error' ? 'error' : 'warning',
      category: 'eslint',
      code: rule,
    });
  }

  // Parse build errors
  // Format: Error: Command "npm run build" exited with 1
  const buildErrorRegex = /Error:\s*Command\s*"([^"]+)"\s*exited\s*with\s*(\d+)/g;
  while ((match = buildErrorRegex.exec(allLogs)) !== null) {
    const [, command, exitCode] = match;
    errors.push({
      message: `Build failed: ${command} exited with code ${exitCode}`,
      severity: 'error',
      category: 'build',
      code: 'BUILD_ERROR',
    });
  }

  // Parse "Failed to compile" errors
  if (allLogs.includes('Failed to compile')) {
    // Extract the specific error context
    const failedCompileRegex = /Failed to compile\.\s*\n\s*\n\s*([^\n]+)/;
    const failedMatch = failedCompileRegex.exec(allLogs);
    if (failedMatch) {
      const context = failedMatch[1].trim();
      // Only add if we haven't already captured this error
      if (!errors.some(e => e.context === context)) {
        errors.push({
          message: 'Compilation failed',
          severity: 'error',
          category: 'build',
          code: 'COMPILE_ERROR',
          context,
        });
      }
    }
  }

  const hasTypeScriptErrors = errors.some(e => e.category === 'typescript');
  const hasESLintErrors = errors.some(e => e.category === 'eslint');
  const hasBuildErrors = errors.some(e => e.category === 'build');

  const summary = generateErrorSummary(errors);

  return {
    errors,
    hasTypeScriptErrors,
    hasESLintErrors,
    hasBuildErrors,
    summary,
  };
}

/**
 * Generate a human-readable summary of deployment errors
 */
function generateErrorSummary(errors: DeploymentError[]): string {
  if (errors.length === 0) {
    return 'No errors found';
  }

  const typeScriptErrors = errors.filter(e => e.category === 'typescript');
  const eslintErrors = errors.filter(e => e.category === 'eslint');
  const buildErrors = errors.filter(e => e.category === 'build');

  const parts: string[] = [];

  if (typeScriptErrors.length > 0) {
    parts.push(`${typeScriptErrors.length} TypeScript error(s)`);
  }
  if (eslintErrors.length > 0) {
    parts.push(`${eslintErrors.length} ESLint error(s)`);
  }
  if (buildErrors.length > 0) {
    parts.push(`${buildErrors.length} build error(s)`);
  }

  return `Deployment failed with ${parts.join(', ')}`;
}

/**
 * Format errors for LLM consumption
 */
export function formatErrorsForLLM(parsed: ParsedDeploymentErrors): string {
  if (parsed.errors.length === 0) {
    return 'No errors to fix';
  }

  const lines: string[] = [
    '🚨 DEPLOYMENT BUILD ERRORS:',
    '',
    parsed.summary,
    '',
    'ERRORS TO FIX:',
    '',
  ];

  for (const error of parsed.errors) {
    const location = error.file
      ? `${error.file}${error.line ? `:${error.line}` : ''}${error.column ? `:${error.column}` : ''}`
      : 'Unknown location';

    lines.push(`[${error.category.toUpperCase()}] ${location}`);
    lines.push(`  ${error.message}`);
    if (error.context) {
      lines.push(`  Context: ${error.context}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Extract files that need fixing based on errors
 */
export function getFilesToFix(
  parsed: ParsedDeploymentErrors,
  allFiles: { filename: string; content: string }[]
): { filename: string; content: string }[] {
  const filesToFix = new Set<string>();

  // Add files mentioned in errors
  for (const error of parsed.errors) {
    if (error.file) {
      filesToFix.add(error.file);
    }
  }

  // If ESLint config errors, include the config file
  if (parsed.hasESLintErrors) {
    filesToFix.add('eslint.config.mjs');
    filesToFix.add('.eslintrc.json');
    filesToFix.add('.eslintrc.js');
  }

  // Return the actual file objects
  return allFiles.filter(f => filesToFix.has(f.filename));
}
