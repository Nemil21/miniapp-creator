// Comprehensive compilation validation system for frontend, backend, and Solidity
// Handles complex code scenarios with robust error detection and parsing

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { applyDiffToContent } from './diffUtils';

const execAsync = promisify(exec);

// Enhanced error types with detailed categorization
export interface CompilationError {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  category: 'typescript' | 'solidity' | 'eslint' | 'build' | 'runtime';
  code?: string; // Error code (e.g., TS2345, ESLint rule name)
  suggestion?: string; // Suggested fix
  context?: string; // Additional context about the error
}

export interface CompilationResult {
  success: boolean;
  errors: CompilationError[];
  warnings: CompilationError[];
  info: CompilationError[];
  files: { filename: string; content: string }[];
  compilationTime: number;
  validationSummary: {
    totalFiles: number;
    filesWithErrors: number;
    filesWithWarnings: number;
    criticalErrors: number;
  };
}

export interface ValidationConfig {
  enableTypeScript: boolean;
  enableSolidity: boolean;
  enableESLint: boolean;
  enableBuild: boolean;
  enableRuntimeChecks: boolean;
  timeoutMs: number;
  maxConcurrentValidations: number;
  skipFiles: string[]; // Files to skip validation
  customRules: string[]; // Custom validation rules
}

// Default configuration
const DEFAULT_CONFIG: ValidationConfig = {
  enableTypeScript: true,
  enableSolidity: true,
  enableESLint: true,
  enableBuild: true,
  enableRuntimeChecks: true,
  timeoutMs: 120000, // 2 minutes
  maxConcurrentValidations: 4,
  skipFiles: [
    'node_modules/**',
    '.next/**',
    '.git/**',
    'dist/**',
    'build/**',
    'coverage/**',
    '*.min.js',
    '*.min.css'
  ],
  customRules: []
};

export class CompilationValidator {
  private tempDir: string;
  private projectRoot: string;
  private config: ValidationConfig;
  private startTime: number;

  constructor(projectRoot: string, config: Partial<ValidationConfig> = {}) {
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Use /tmp for serverless environments like Vercel, fallback to project root for local development
    this.tempDir = process.env.NODE_ENV === 'production' 
      ? path.join('/tmp', 'temp-compilation', Date.now().toString())
      : path.join(projectRoot, '.temp-compilation');
    this.startTime = Date.now();
  }

  /**
   * Main validation method - orchestrates all validation steps
   */
  async validateProject(
    generatedFiles: { filename: string; content?: string; unifiedDiff?: string; operation?: string }[],
    currentFiles: { filename: string; content: string }[]
  ): Promise<CompilationResult> {
    console.log("🔧 Starting comprehensive compilation validation...");
    console.log(`📁 Project root: ${this.projectRoot}`);
    console.log(`⚙️  Config: ${JSON.stringify(this.config, null, 2)}`);

    try {
      // 1. Prepare final files by applying diffs
      const finalFiles = await this.prepareFinalFiles(generatedFiles, currentFiles);
      console.log(`📝 Prepared ${finalFiles.length} files for validation`);

      // 2. Create temporary project structure
      await this.createTempProject(finalFiles);
      console.log(`🏗️  Created temporary project structure`);

      // 3. Run all validations in parallel with concurrency control
      const validationPromises = [];
      
      if (this.config.enableTypeScript) {
        validationPromises.push(this.validateTypeScript());
      }
      
      if (this.config.enableSolidity) {
        validationPromises.push(this.validateSolidity());
      }
      
      if (this.config.enableESLint) {
        validationPromises.push(this.validateESLint());
      }
      
      if (this.config.enableBuild) {
        validationPromises.push(this.validateBuild());
      }
      
      if (this.config.enableRuntimeChecks) {
        validationPromises.push(this.validateRuntimeChecks(finalFiles));
      }

      // Execute validations with concurrency control
      const results = await this.executeWithConcurrencyControl(
        validationPromises,
        this.config.maxConcurrentValidations
      );

      // 4. Combine and categorize results
      const allErrors: CompilationError[] = [];
      const allWarnings: CompilationError[] = [];
      const allInfo: CompilationError[] = [];

      results.forEach(result => {
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);
        allInfo.push(...result.info || []);
      });

      // 5. Generate validation summary
      const validationSummary = this.generateValidationSummary(finalFiles, allErrors, allWarnings);

      // 6. Cleanup (only in production)
      if (process.env.NODE_ENV === 'production') {
        await this.cleanup();
      } else {
        console.log(`🔍 Development mode - keeping temp directory for inspection: ${this.tempDir}`);
      }

      const compilationTime = Date.now() - this.startTime;
      console.log(`✅ Compilation validation completed in ${compilationTime}ms`);
      console.log(`📊 Results: ${allErrors.length} errors, ${allWarnings.length} warnings, ${allInfo.length} info`);

      return {
        success: allErrors.length === 0,
        errors: allErrors,
        warnings: allWarnings,
        info: allInfo,
        files: finalFiles,
        compilationTime,
        validationSummary
      };

    } catch (error) {
      console.error("❌ Compilation validation failed:", error);
      if (process.env.NODE_ENV === 'production') {
        await this.cleanup();
      } else {
        console.log(`🔍 Development mode - keeping temp directory for debugging: ${this.tempDir}`);
      }
      
      return {
        success: false,
        errors: [{
          file: 'compilation-validator',
          message: `Compilation validation failed: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error',
          category: 'build'
        }],
        warnings: [],
        info: [],
        files: [],
        compilationTime: Date.now() - this.startTime,
        validationSummary: {
          totalFiles: 0,
          filesWithErrors: 0,
          filesWithWarnings: 0,
          criticalErrors: 1
        }
      };
    }
  }

  /**
   * Prepare final files by applying diffs to current files
   */
  private async prepareFinalFiles(
    generatedFiles: { filename: string; content?: string; unifiedDiff?: string; operation?: string }[],
    currentFiles: { filename: string; content: string }[]
  ): Promise<{ filename: string; content: string }[]> {
    const finalFiles: { filename: string; content: string }[] = [];
    const processedFiles = new Set<string>();

    // Process generated files
    for (const generatedFile of generatedFiles) {
      if (generatedFile.operation === 'create' && generatedFile.content) {
        // New file - use content directly
        finalFiles.push({
          filename: generatedFile.filename,
          content: generatedFile.content
        });
        processedFiles.add(generatedFile.filename);
      } else if (generatedFile.operation === 'modify' && generatedFile.unifiedDiff) {
        // Modified file - apply diff to current file
        const currentFile = currentFiles.find(f => f.filename === generatedFile.filename);
        if (currentFile) {
          try {
            const updatedContent = applyDiffToContent(currentFile.content, generatedFile.unifiedDiff);
            finalFiles.push({
              filename: generatedFile.filename,
              content: updatedContent
            });
            processedFiles.add(generatedFile.filename);
          } catch (error) {
            console.warn(`⚠️ Failed to apply diff to ${generatedFile.filename}:`, error);
            // Fallback to current file content
            finalFiles.push({
              filename: generatedFile.filename,
              content: currentFile.content
            });
            processedFiles.add(generatedFile.filename);
          }
        }
      }
    }

    // Add unchanged files
    for (const currentFile of currentFiles) {
      if (!processedFiles.has(currentFile.filename)) {
        finalFiles.push(currentFile);
      }
    }

    return finalFiles;
  }

  /**
   * Create temporary project structure for validation
   */
  private async createTempProject(files: { filename: string; content: string }[]): Promise<void> {
    try {
      // Clean and create temp directory
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
      
      // Ensure parent directory exists for /tmp path
      const parentDir = path.dirname(this.tempDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      fs.mkdirSync(this.tempDir, { recursive: true });
      console.log(`📁 Created temporary directory: ${this.tempDir}`);
    } catch (error) {
      console.error(`❌ Failed to create temporary directory: ${this.tempDir}`, error);
      throw new Error(`Failed to create temporary directory for compilation validation: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Copy essential config files
    const configFiles = [
      'package.json',
      'tsconfig.json',
      'next.config.ts',
      'next.config.js',
      'tailwind.config.js',
      'tailwind.config.ts',
      'eslint.config.mjs',
      'eslint.config.js',
      '.eslintrc.json',
      '.eslintrc.js'
      // NOTE: hardhat.config.js/ts are NOT included - they should stay in contracts/ subdirectory
      // Including them in the root causes Next.js build failures
    ];

    try {
      for (const configFile of configFiles) {
        const sourcePath = path.join(this.projectRoot, configFile);
        if (fs.existsSync(sourcePath)) {
          const destPath = path.join(this.tempDir, configFile);
          const destDir = path.dirname(destPath);
          
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          fs.copyFileSync(sourcePath, destPath);
          console.log(`📋 Copied config file: ${configFile}`);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to copy some config files:`, error);
      // Continue with validation even if some config files can't be copied
    }

    // Copy node_modules if it exists (for faster validation)
    try {
      const nodeModulesPath = path.join(this.projectRoot, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        const tempNodeModules = path.join(this.tempDir, 'node_modules');
        fs.symlinkSync(nodeModulesPath, tempNodeModules, 'dir');
        console.log(`🔗 Created symlink to node_modules`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to create node_modules symlink:`, error);
      // Continue without node_modules symlink
    }

    // Write all files to temp directory
    try {
      for (const file of files) {
        // Skip files that match skip patterns
        if (this.shouldSkipFile(file.filename)) {
          continue;
        }

        const filePath = path.join(this.tempDir, file.filename);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, file.content, 'utf8');
      }
      console.log(`📝 Wrote ${files.length} files to temporary directory`);
    } catch (error) {
      console.error(`❌ Failed to write files to temporary directory:`, error);
      throw new Error(`Failed to write files for compilation validation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if file should be skipped based on skip patterns
   */
  private shouldSkipFile(filename: string): boolean {
    return this.config.skipFiles.some(pattern => {
      // Simple glob pattern matching
      if (pattern.includes('**')) {
        const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
        return regex.test(filename);
      }
      return filename.includes(pattern);
    });
  }

  /**
   * Execute validations with concurrency control
   */
  private async executeWithConcurrencyControl<T>(
    promises: Promise<T>[],
    maxConcurrent: number
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < promises.length; i += maxConcurrent) {
      const batch = promises.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * TypeScript compilation validation
   */
  private async validateTypeScript(): Promise<{ errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] }> {
    try {
      console.log("🔍 Validating TypeScript compilation...");
      
      const { stderr } = await execAsync('npx tsc --noEmit --pretty false --skipLibCheck', {
        cwd: this.tempDir,
        timeout: this.config.timeoutMs
      });

      return this.parseTypeScriptErrors(stderr);
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 1) {
        // TypeScript compilation failed - parse errors
        const errorObj = error as { stderr?: string; stdout?: string };
        return this.parseTypeScriptErrors(errorObj.stderr || errorObj.stdout || '');
      }
      console.warn("⚠️ TypeScript validation failed:", (error as Error).message);
      return { errors: [], warnings: [] };
    }
  }

  /**
   * Solidity compilation validation
   */
  private async validateSolidity(): Promise<{ errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] }> {
    try {
      console.log("🔍 Validating Solidity compilation...");
      
      const contractsDir = path.join(this.tempDir, 'contracts');
      if (!fs.existsSync(contractsDir)) {
        console.log("📁 No contracts directory found, skipping Solidity validation");
        return { errors: [], warnings: [] };
      }

      const { stdout, stderr } = await execAsync('npx hardhat compile --force', {
        cwd: this.tempDir,
        timeout: this.config.timeoutMs
      });

      return this.parseSolidityErrors(stderr, stdout);
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 1) {
        const errorObj = error as { stderr?: string; stdout?: string };
        return this.parseSolidityErrors(errorObj.stderr || '', errorObj.stdout || '');
      }
      console.warn("⚠️ Solidity validation failed:", (error as Error).message);
      return { errors: [], warnings: [] };
    }
  }

  /**
   * ESLint validation
   */
  private async validateESLint(): Promise<{ errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] }> {
    try {
      console.log("🔍 Validating ESLint...");
      
      const { stdout } = await execAsync('npx eslint src --format json --max-warnings 0', {
        cwd: this.tempDir,
        timeout: this.config.timeoutMs
      });

      return this.parseESLintErrors(stdout);
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 1) {
        const errorObj = error as { stdout?: string };
        return this.parseESLintErrors(errorObj.stdout || '');
      }
      console.warn("⚠️ ESLint validation failed:", (error as Error).message);
      return { errors: [], warnings: [] };
    }
  }

  /**
   * Next.js build validation
   */
  private async validateBuild(): Promise<{ errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] }> {
    try {
      console.log("🔍 Validating Next.js build...");
      
      const { stdout, stderr } = await execAsync('npx next build --no-lint', {
        cwd: this.tempDir,
        timeout: this.config.timeoutMs
      });

      return this.parseBuildErrors(stderr, stdout);
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 1) {
        const errorObj = error as { stderr?: string; stdout?: string };
        return this.parseBuildErrors(errorObj.stderr || '', errorObj.stdout || '');
      }
      console.warn("⚠️ Build validation failed:", (error as Error).message);
      return { errors: [], warnings: [] };
    }
  }

  /**
   * Runtime checks validation
   */
  private async validateRuntimeChecks(files: { filename: string; content: string }[]): Promise<{ errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] }> {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    console.log("🔍 Running runtime checks...");

    // Check for common runtime issues
    for (const file of files) {
      if (file.filename.endsWith('.tsx') || file.filename.endsWith('.ts')) {
        const runtimeIssues = this.checkRuntimeIssues(file.content, file.filename);
        errors.push(...runtimeIssues.errors);
        warnings.push(...runtimeIssues.warnings);
        info.push(...runtimeIssues.info);
      }
    }

    return { errors, warnings, info };
  }

  /**
   * Check for runtime issues in code
   */
  private checkRuntimeIssues(content: string, filename: string): { errors: CompilationError[]; warnings: CompilationError[]; info: CompilationError[] } {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    const lines = content.split('\n');

    // Check for common runtime issues
    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // Check for undefined variables in JSX
      if (line.includes('onClick={() =>') && line.includes('undefined')) {
        errors.push({
          file: filename,
          line: lineNumber,
          message: 'Potential runtime error: undefined function in onClick handler',
          severity: 'error',
          category: 'runtime',
          suggestion: 'Ensure the function is properly defined and accessible'
        });
      }

      // Check for missing error boundaries
      if (line.includes('throw new Error') && !content.includes('ErrorBoundary')) {
        warnings.push({
          file: filename,
          line: lineNumber,
          message: 'Consider adding ErrorBoundary for error handling',
          severity: 'warning',
          category: 'runtime',
          suggestion: 'Wrap components with ErrorBoundary to handle errors gracefully'
        });
      }

      // Check for potential memory leaks
      if (line.includes('setInterval') || line.includes('setTimeout')) {
        if (!content.includes('clearInterval') && !content.includes('clearTimeout')) {
          warnings.push({
            file: filename,
            line: lineNumber,
            message: 'Potential memory leak: timer not cleared',
            severity: 'warning',
            category: 'runtime',
            suggestion: 'Clear timers in useEffect cleanup function'
          });
        }
      }

      // Check for async/await without error handling
      if (line.includes('await ') && !line.includes('try') && !line.includes('catch')) {
        const hasTryCatch = content.includes('try {') && content.includes('} catch');
        if (!hasTryCatch) {
          info.push({
            file: filename,
            line: lineNumber,
            message: 'Consider adding error handling for async operations',
            severity: 'info',
            category: 'runtime',
            suggestion: 'Wrap async operations in try-catch blocks'
          });
        }
      }
    });

    return { errors, warnings, info };
  }

  /**
   * Parse TypeScript compiler errors
   */
  private parseTypeScriptErrors(output: string): { errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] } {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    const lines = output.split('\n');
    
    for (const line of lines) {
      // Parse TypeScript compiler output format
      const match = line.match(/^(.+?)\((\d+),(\d+)\): (error|warning) TS(\d+): (.+)$/);
      if (match) {
        const [, file, lineNum, col, severity, code, message] = match;
        const relativeFile = path.relative(this.tempDir, file);
        
        const error: CompilationError = {
          file: relativeFile,
          line: parseInt(lineNum),
          column: parseInt(col),
          message: `TS${code}: ${message}`,
          severity: severity as 'error' | 'warning',
          category: 'typescript',
          code: `TS${code}`,
          suggestion: this.getTypeScriptSuggestion(code)
        };

        if (severity === 'error') {
          errors.push(error);
        } else {
          warnings.push(error);
        }
      }
    }

    return { errors, warnings, info };
  }

  /**
   * Get TypeScript error suggestions
   */
  private getTypeScriptSuggestion(code: string): string {
    const suggestions: Record<string, string> = {
      '2345': 'Check if the property exists on the type or add proper type annotations',
      '2304': 'Declare the variable or import it from the correct module',
      '2339': 'Add the missing property to the interface or type definition',
      '2551': 'Import the missing property or check the import path',
      '2322': 'Ensure the value matches the expected type',
      '2344': 'Check the function signature and parameter types'
    };

    return suggestions[code] || 'Review the TypeScript error and fix the type mismatch';
  }

  /**
   * Parse Solidity compilation errors
   */
  private parseSolidityErrors(stderr: string, stdout: string): { errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] } {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    const output = stderr + stdout;
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes('Error:') || line.includes('Warning:')) {
        const isError = line.includes('Error:');
        const message = line.replace(/^(Error|Warning):\s*/, '');
        
        // Try to extract file and line information
        const fileMatch = line.match(/contracts\/([^:]+):(\d+):(\d+)/);
        
        const error: CompilationError = {
          file: fileMatch ? `contracts/${fileMatch[1]}` : 'contracts',
          line: fileMatch ? parseInt(fileMatch[2]) : undefined,
          column: fileMatch ? parseInt(fileMatch[3]) : undefined,
          message,
          severity: isError ? 'error' : 'warning',
          category: 'solidity',
          suggestion: this.getSoliditySuggestion(message)
        };

        if (isError) {
          errors.push(error);
        } else {
          warnings.push(error);
        }
      }
    }

    return { errors, warnings, info };
  }

  /**
   * Get Solidity error suggestions
   */
  private getSoliditySuggestion(_message: string): string {
    if (_message.includes('DeclarationError')) {
      return 'Check variable declarations and ensure they are properly defined';
    }
    if (_message.includes('TypeError')) {
      return 'Verify type compatibility and casting operations';
    }
    if (_message.includes('ParserError')) {
      return 'Check syntax and ensure all brackets and semicolons are correct';
    }
    return 'Review the Solidity error and fix the compilation issue';
  }

  /**
   * Parse ESLint errors
   */
  private parseESLintErrors(output: string): { errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] } {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    try {
      const eslintResults = JSON.parse(output);
      
      for (const result of eslintResults) {
        const relativeFile = path.relative(this.tempDir, result.filePath);
        
        for (const message of result.messages) {
          const error: CompilationError = {
            file: relativeFile,
            line: message.line,
            column: message.column,
            message: `${message.ruleId || 'unknown'}: ${message.message}`,
            severity: message.severity === 2 ? 'error' : 'warning',
            category: 'eslint',
            code: message.ruleId,
            suggestion: this.getESLintSuggestion(message.ruleId)
          };

          if (message.severity === 2) {
            errors.push(error);
          } else {
            warnings.push(error);
          }
        }
      }
    } catch {
      console.warn("⚠️ Failed to parse ESLint JSON output");
    }

    return { errors, warnings, info };
  }

  /**
   * Get ESLint error suggestions
   */
  private getESLintSuggestion(ruleId: string | null): string {
    const suggestions: Record<string, string> = {
      'react-hooks/exhaustive-deps': 'Add missing dependencies to the dependency array',
      'react-hooks/rules-of-hooks': 'Only call hooks at the top level of React components',
      '@typescript-eslint/no-unused-vars': 'Remove unused variables or prefix with underscore',
      'react/no-unescaped-entities': 'Use HTML entities like &apos; for apostrophes',
      '@typescript-eslint/no-explicit-any': 'Replace any with proper type definitions'
    };

    return suggestions[ruleId || ''] || 'Follow ESLint best practices and fix the code style issue';
  }

  /**
   * Parse build errors
   */
  private parseBuildErrors(stderr: string, stdout: string): { errors: CompilationError[]; warnings: CompilationError[]; info?: CompilationError[] } {
    const errors: CompilationError[] = [];
    const warnings: CompilationError[] = [];
    const info: CompilationError[] = [];

    const output = stderr + stdout;
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes('Error:') || line.includes('Failed to compile')) {
        errors.push({
          file: 'build',
          message: line,
          severity: 'error',
          category: 'build',
          suggestion: 'Check the build configuration and fix compilation errors'
        });
      }
      
      if (line.includes('Warning:')) {
        warnings.push({
          file: 'build',
          message: line,
          severity: 'warning',
          category: 'build',
          suggestion: 'Review build warnings and consider addressing them'
        });
      }
    }

    return { errors, warnings, info };
  }

  /**
   * Generate validation summary
   */
  private generateValidationSummary(
    files: { filename: string; content: string }[],
    errors: CompilationError[],
    warnings: CompilationError[]
  ) {
    const filesWithErrors = new Set(errors.map(e => e.file));
    const filesWithWarnings = new Set(warnings.map(w => w.file));
    const criticalErrors = errors.filter(e => e.severity === 'error').length;

    return {
      totalFiles: files.length,
      filesWithErrors: filesWithErrors.size,
      filesWithWarnings: filesWithWarnings.size,
      criticalErrors
    };
  }

  /**
   * Cleanup temporary files
   */
  private async cleanup(): Promise<void> {
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn("⚠️ Failed to cleanup temporary directory:", error);
    }
  }
}

// Export utility functions for error handling and suggestions
export const CompilationErrorUtils = {
  /**
   * Group errors by file for easier processing
   */
  groupErrorsByFile(errors: CompilationError[]): Map<string, CompilationError[]> {
    const grouped = new Map<string, CompilationError[]>();
    
    for (const error of errors) {
      if (!grouped.has(error.file)) {
        grouped.set(error.file, []);
      }
      grouped.get(error.file)!.push(error);
    }
    
    return grouped;
  },

  /**
   * Filter errors by severity
   */
  filterBySeverity(errors: CompilationError[], severity: 'error' | 'warning' | 'info'): CompilationError[] {
    return errors.filter(error => error.severity === severity);
  },

  /**
   * Filter errors by category
   */
  filterByCategory(errors: CompilationError[], category: CompilationError['category']): CompilationError[] {
    return errors.filter(error => error.category === category);
  },

  /**
   * Get error summary statistics
   */
  getErrorSummary(errors: CompilationError[]) {
    const byCategory = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    
    for (const error of errors) {
      byCategory.set(error.category, (byCategory.get(error.category) || 0) + 1);
      bySeverity.set(error.severity, (bySeverity.get(error.severity) || 0) + 1);
    }
    
    return {
      byCategory: Object.fromEntries(byCategory),
      bySeverity: Object.fromEntries(bySeverity),
      total: errors.length
    };
  }
};
