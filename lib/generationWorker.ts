/**
 * Background worker for processing generation jobs
 * This module handles the long-running generation tasks asynchronously
 */

import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  getGenerationJobById,
  updateGenerationJobStatus,
  createProject,
  saveProjectFiles,
  getUserById,
  getProjectById,
  createDeployment,
  getProjectFiles,
  savePatch,
  updateProject,
  type GenerationJobContext,
} from "./database";
import { executeEnhancedPipeline } from "./enhancedPipeline";
import { executeDiffBasedPipeline } from "./diffBasedPipeline";
import {
  createPreview,
  saveFilesToGenerated,
  getPreviewUrl,
  deployContractsFirst,
  redeployToVercel,
} from "./previewManager";
import { STAGE_MODEL_CONFIG, ANTHROPIC_MODELS } from "./llmOptimizer";
import { updateFilesWithContractAddresses } from "./contractAddressInjector";
import {
  parseVercelDeploymentErrors,
  formatErrorsForLLM,
  getFilesToFix,
} from "./deploymentErrorParser";
import { logger } from "./logger";


const CUSTOM_DOMAIN_BASE = process.env.CUSTOM_DOMAIN_BASE || 'minidev.fun';

// Utility: Recursively read all files in a directory
async function readAllFiles(
  dir: string,
  base = ""
): Promise<{ filename: string; content: string }[]> {
  const files: { filename: string; content: string }[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === "pnpm-lock.yaml" ||
      entry.name === "package-lock.json" ||
      entry.name === "yarn.lock" ||
      entry.name === "bun.lockb" ||
      entry.name === "pnpm-workspace.yaml" ||
      entry.name === ".DS_Store" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = base ? path.join(base, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await readAllFiles(fullPath, relPath)));
    } else {
      try {
        const content = await fs.readFile(fullPath, "utf8");

        if (content.includes('\0') || content.includes('\x00')) {
          logger.log(`⚠️ Skipping binary file: ${relPath}`);
          continue;
        }

        const sanitizedContent = content
          .replace(/\0/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        files.push({ filename: relPath, content: sanitizedContent });
      } catch (error) {
        logger.log(`⚠️ Skipping binary file: ${relPath} (${error})`);
        continue;
      }
    }
  }
  return files;
}

// Utility: Write files to disk
async function writeFilesToDir(
  baseDir: string,
  files: { filename: string; content: string }[]
) {
  for (const file of files) {
    const filePath = path.join(baseDir, file.filename);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, file.content, "utf8");
  }
}

// Fetch boilerplate from GitHub API
async function fetchBoilerplateFromGitHub(targetDir: string, appType: 'farcaster' | 'web3' = 'farcaster') {
  const repoOwner = "Nemil21";
  const repoName = appType === 'web3' ? 'web3-boilerplate' : 'minidev-boilerplate';
  
  // Fetch repository contents recursively
  async function fetchDirectoryContents(dirPath: string = ""): Promise<void> {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dirPath}`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'minidev-app'
    };
    
    // Add authentication if GitHub token is available
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const contents = await response.json();
    
    for (const item of contents) {
      const itemPath = dirPath ? path.join(dirPath, item.name) : item.name;
      
      // Skip certain files/directories
      if (
        item.name === "node_modules" ||
        item.name === ".git" ||
        item.name === ".next" ||
        item.name === "dist" ||
        item.name === "build" ||
        item.name === "pnpm-lock.yaml" ||
        item.name === "package-lock.json" ||
        item.name === "yarn.lock" ||
        item.name === "bun.lockb" ||
        item.name === "pnpm-workspace.yaml" ||
        item.name === ".DS_Store" ||
        item.name.startsWith(".")
      ) {
        continue;
      }
      
      if (item.type === "file") {
        // Fetch file content
        const fileResponse = await fetch(item.download_url);
        if (!fileResponse.ok) {
          logger.warn(`⚠️ Failed to fetch file ${itemPath}: ${fileResponse.status}`);
          continue;
        }
        
        const content = await fileResponse.text();
        
        // Check for binary content
        if (content.includes('\0') || content.includes('\x00')) {
          logger.log(`⚠️ Skipping binary file: ${itemPath}`);
          continue;
        }
        
        // Write file to target directory
        const filePath = path.join(targetDir, itemPath);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, "utf8");
        
      } else if (item.type === "dir") {
        // Recursively fetch directory contents
        await fetchDirectoryContents(itemPath);
      }
    }
  }
  
  await fetchDirectoryContents();
}

// LLM caller with retry logic
async function callClaudeWithLogging(
  systemPrompt: string,
  userPrompt: string,
  stageName: string,
  stageType?: keyof typeof STAGE_MODEL_CONFIG
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("Claude API key not set in environment");

  let modelConfig = stageType
    ? STAGE_MODEL_CONFIG[stageType]
    : STAGE_MODEL_CONFIG.LEGACY_SINGLE_STAGE;

  if (stageName.includes('(Retry)') && stageType === 'STAGE_3_CODE_GENERATOR') {
    const increasedTokens = Math.min(modelConfig.maxTokens * 2, 40000);
    modelConfig = {
      ...modelConfig,
      maxTokens: increasedTokens
    } as typeof modelConfig;
  }

  logger.log(`\n🤖 LLM Call - ${stageName}`);
  logger.log("  Model:", modelConfig.model);
  logger.log("  Max Tokens:", modelConfig.maxTokens);

  const body = {
    model: modelConfig.model,
    max_tokens: modelConfig.maxTokens,
    temperature: modelConfig.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      const throttleDelay = Math.min(500 * attempt, 2000);
      logger.log(`⏱️ Throttling request (attempt ${attempt}), waiting ${throttleDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, throttleDelay));
    }

    try {
      const startTime = Date.now();

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 529 || response.status === 429) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              logger.log(`⚠️ API ${response.status} error, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              logger.log(`⚠️ API ${response.status} error, retrying in ${delay}ms...`);
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            throw new Error(
              `Claude API overloaded after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else if (response.status >= 500) {
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              logger.log(`⚠️ Server error ${response.status}, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              logger.log(`⚠️ Server error ${response.status}, retrying in ${delay}ms...`);
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            throw new Error(
              `Claude API server error after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else {
          throw new Error(`Claude API error: ${response.status} ${errorText}`);
        }
      }

      const responseData = await response.json();
      const endTime = Date.now();

      const responseText = responseData.content[0]?.text || "";

      const inputTokens = responseData.usage?.input_tokens || 0;
      const outputTokens = responseData.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;

      const actualCost = calculateActualCost(inputTokens, outputTokens, modelConfig.model);

      logger.log("📥 Output:");
      logger.log("  Response Time:", endTime - startTime, "ms");
      logger.log("  Total Tokens:", totalTokens);
      logger.log("  Cost:", actualCost);

      return responseText;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`❌ LLM API Error (${stageName}) after ${maxRetries} attempts:`, error);
        throw error;
      }

      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes("fetch"))
      ) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        logger.log(`⚠️ Network error, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Failed to get response from Claude API after ${maxRetries} attempts`
  );
}

function calculateActualCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): string {
  let costPer1MInput = 0;
  let costPer1MOutput = 0;

  switch (model) {
    case ANTHROPIC_MODELS.FAST:
      costPer1MInput = 0.25;
      costPer1MOutput = 1.25;
      break;
    case ANTHROPIC_MODELS.BALANCED:
      costPer1MInput = 3;
      costPer1MOutput = 15;
      break;
    case ANTHROPIC_MODELS.POWERFUL:
      costPer1MInput = 15;
      costPer1MOutput = 75;
      break;
  }

  const inputCost = (inputTokens / 1000000) * costPer1MInput;
  const outputCost = (outputTokens / 1000000) * costPer1MOutput;
  const totalCost = inputCost + outputCost;

  return `$${totalCost.toFixed(6)}`;
}

function generateProjectName(intentSpec: { feature: string; reason?: string }): string {
  let projectName = intentSpec.feature;

  projectName = projectName
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = projectName.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  );

  projectName = words.join(' ');

  const appTerms = ['app', 'application', 'miniapp', 'mini app', 'dashboard', 'platform', 'tool', 'game', 'player', 'gallery', 'blog', 'store', 'shop'];
  const hasAppTerm = appTerms.some(term => projectName.toLowerCase().includes(term));

  if (!hasAppTerm) {
    projectName += ' App';
  }

  if (projectName.toLowerCase().includes('bootstrap') || projectName.toLowerCase().includes('template')) {
    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Miniapp ${timeStr}`;
  }

  return projectName;
}

// Helper function to get project directory path
function getProjectDir(projectId: string): string {
  const outputDir = process.env.NODE_ENV === 'production'
    ? '/tmp/generated'
    : path.join(process.cwd(), 'generated');
  return path.join(outputDir, projectId);
}

/**
 * Fix deployment errors by parsing Vercel build logs and calling LLM to fix issues
 */
async function fixDeploymentErrors(
  deploymentError: string,
  deploymentLogs: string,
  currentFiles: { filename: string; content: string }[],
  projectId: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(70));
  logger.log("🔧 DEPLOYMENT ERROR DETECTED - ATTEMPTING TO FIX");
  logger.log("=".repeat(70));
  logger.log(`🔍 [FIX-DEBUG] Input parameters:`);
  logger.log(`🔍 [FIX-DEBUG] - deploymentError length: ${deploymentError.length}`);
  logger.log(`🔍 [FIX-DEBUG] - deploymentLogs length: ${deploymentLogs.length}`);
  logger.log(`🔍 [FIX-DEBUG] - currentFiles count: ${currentFiles.length}`);
  logger.log(`🔍 [FIX-DEBUG] - projectId: ${projectId}`);
  logger.log(`🔍 [FIX-DEBUG] First 500 chars of error:\n${deploymentError.substring(0, 500)}`);

  // Parse deployment errors
  const parsed = parseVercelDeploymentErrors(deploymentError, deploymentLogs);
  logger.log(`📊 Parsed errors: ${parsed.errors.length} total`);
  logger.log(`   - TypeScript: ${parsed.hasTypeScriptErrors ? 'YES' : 'NO'}`);
  logger.log(`   - ESLint: ${parsed.hasESLintErrors ? 'YES' : 'NO'}`);
  logger.log(`   - Build: ${parsed.hasBuildErrors ? 'YES' : 'NO'}`);
  logger.log(`🔍 [FIX-DEBUG] Parsed error details:`, JSON.stringify(parsed.errors.slice(0, 3), null, 2));

  if (parsed.errors.length === 0) {
    logger.log("⚠️ No parseable errors found in deployment logs");
    logger.log(`🔍 [FIX-DEBUG] Returning ${currentFiles.length} original files unchanged`);
    return currentFiles;
  }

  // Get files that need fixing
  const filesToFix = getFilesToFix(parsed, currentFiles);
  logger.log(`📝 Files to fix: ${filesToFix.length}`);
  filesToFix.forEach(f => logger.log(`   - ${f.filename}`));

  if (filesToFix.length === 0) {
    logger.log("⚠️ No files identified for fixing");
    return currentFiles;
  }

  // Format errors for LLM
  const errorMessage = formatErrorsForLLM(parsed);
  logger.log("\n📋 Error summary for LLM:");
  logger.log(errorMessage);

  // Import getStage4ValidatorPrompt from llmOptimizer
  const { getStage4ValidatorPrompt } = await import('./llmOptimizer');
  
  // Create LLM prompt to fix errors
  const fixPrompt = getStage4ValidatorPrompt(
    filesToFix,
    [errorMessage],
    false, // Use diff-based fixes, not complete file rewrites
    appType // Pass app type for correct context
  );

  logger.log(`\n🤖 Calling LLM to fix deployment errors...`);
  logger.log(`🔍 [FIX-DEBUG] LLM prompt length: ${fixPrompt.length} chars`);
  logger.log(`🔍 [FIX-DEBUG] Using diff-based fixes: true`);
  
  const fixResponse = await callClaudeWithLogging(
    fixPrompt,
    "",
    "Stage 4: Deployment Error Fixes",
    "STAGE_4_VALIDATOR"
  );

  logger.log(`🔍 [FIX-DEBUG] LLM response received, length: ${fixResponse.length} chars`);
  logger.log(`🔍 [FIX-DEBUG] Response preview (first 500 chars):\n${fixResponse.substring(0, 500)}`);

  // Log the response for debugging
  logger.log(`📊 [${projectId}] Stage 4 Deployment Error Fixes:`, {
    errorCount: parsed.errors.length,
    filesToFix: filesToFix.length,
    responseLength: fixResponse.length,
  });
  logger.log(`🔍 [FIX-DEBUG] Response logged to stage4-deployment-error-fixes`);

  // Parse LLM response
  const { parseStage4ValidatorResponse } = await import('./parserUtils');
  const { applyDiffsToFiles } = await import('./diffBasedPipeline');
  
  try {
    const fixes = parseStage4ValidatorResponse(fixResponse);
    logger.log(`✅ Parsed ${fixes.length} fixes from LLM`);
    
    // Log what we got from the LLM
    fixes.forEach((fix, idx) => {
      logger.log(`\n📄 Fix ${idx + 1}: ${fix.filename}`);
      logger.log(`   - Has unifiedDiff: ${!!fix.unifiedDiff}`);
      logger.log(`   - Has diffHunks: ${!!fix.diffHunks}`);
      logger.log(`   - Has content: ${!!fix.content}`);
      if (fix.unifiedDiff) {
        logger.log(`   - Diff length: ${fix.unifiedDiff.length} chars`);
        logger.log(`   - Diff preview: ${fix.unifiedDiff.substring(0, 200)}...`);
      }
      if (fix.diffHunks) {
        logger.log(`   - Number of hunks: ${fix.diffHunks.length}`);
      }
    });

    // Convert to FileDiff format (diffHunks -> hunks)
    const fileDiffs = fixes
      .filter(f => f.unifiedDiff && f.diffHunks)
      .map(f => ({
        filename: f.filename,
        hunks: f.diffHunks!,
        unifiedDiff: f.unifiedDiff!,
      }));

    logger.log(`\n🔍 Filtered to ${fileDiffs.length} files with valid diffs (from ${fixes.length} total)`);

    if (fileDiffs.length === 0) {
      logger.log("⚠️ No diff-based fixes found, returning original files");
      logger.log("💡 LLM may have returned full file content instead of diffs");
      
      // Fallback: If LLM returned full content instead of diffs, use that
      const fullContentFixes = fixes.filter(f => f.content && !f.unifiedDiff);
      if (fullContentFixes.length > 0) {
        logger.log(`📝 Found ${fullContentFixes.length} full-content fixes, applying those instead`);
        const updatedFiles = currentFiles.map(currentFile => {
          const fix = fullContentFixes.find(f => f.filename === currentFile.filename);
          return fix ? { ...currentFile, content: fix.content! } : currentFile;
        });
        return updatedFiles;
      }
      
      return currentFiles;
    }

    // Apply fixes to current files
    logger.log(`\n🔧 Applying diffs to files...`);
    const fixedFiles = applyDiffsToFiles(currentFiles, fileDiffs);
    logger.log(`✅ Applied fixes to ${fixedFiles.length} files`);

    return fixedFiles;
  } catch (parseError) {
    logger.error("❌ Failed to parse LLM fix response:", parseError);
    logger.error("Stack trace:", parseError instanceof Error ? parseError.stack : 'No stack trace');
    logger.log("📋 Returning original files");
    return currentFiles;
  }
}

/**
 * Main worker function to execute a generation job
 */
export async function executeGenerationJob(jobId: string): Promise<void> {
  logger.log(`🚀 Starting job execution: ${jobId}`);

  try {
    // Fetch job from database
    const job = await getGenerationJobById(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "processing" && job.status !== "pending") {
      throw new Error(`Job ${jobId} is in ${job.status} state, cannot process`);
    }

    // Mark as processing if it's still pending
    if (job.status === "pending") {
      await updateGenerationJobStatus(jobId, "processing");
    }

    // Extract context from job
    const context = job.context as GenerationJobContext;

    // Route to appropriate handler based on job type
    if (context.isFollowUp) {
      logger.log(`🔄 Detected follow-up job, routing to follow-up handler`);
      return await executeFollowUpJob(jobId, job, context);
    } else {
      logger.log(`🆕 Detected initial generation job, routing to initial generation handler`);
      return await executeInitialGenerationJob(jobId, job, context);
    }
  } catch (error) {
    logger.error(`❌ Job ${jobId} failed:`, error);

    // Update job status to failed
    await updateGenerationJobStatus(
      jobId,
      "failed",
      undefined,
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}

/**
 * Execute initial generation job (new project)
 */
async function executeInitialGenerationJob(
  jobId: string,
  job: Awaited<ReturnType<typeof getGenerationJobById>>,
  context: GenerationJobContext
): Promise<void> {
  const { prompt, existingProjectId } = context;
    const accessToken = process.env.PREVIEW_AUTH_TOKEN;

    if (!accessToken) {
      throw new Error("Missing preview auth token");
    }

    // Get user
    const user = await getUserById(job.userId);
    if (!user) {
      throw new Error(`User ${job.userId} not found`);
    }

    logger.log(`🔧 Processing job for user: ${user.email || user.id}`);
    logger.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);

    // Extract user request
    const lines = prompt.split("\n");
    let userRequest = prompt;

    if (prompt.includes("BUILD THIS MINIAPP:")) {
      const buildMatch = prompt.match(/BUILD THIS MINIAPP:\s*(.+?)(?:\n|$)/);
      if (buildMatch) {
        userRequest = buildMatch[1].trim();
      }
    } else {
      const userMatch = lines.find((line: string) =>
        line.startsWith("User wants to create:")
      );
      if (userMatch) {
        userRequest = userMatch;
      }
    }

    // Use existing project ID or generate new one
    const projectId = existingProjectId || uuidv4();

    logger.log(`📁 Project ID: ${projectId}`);

    // Set up directories
    const outputDir = process.env.NODE_ENV === 'production'
      ? '/tmp/generated'
      : path.join(process.cwd(), 'generated');
    const userDir = path.join(outputDir, projectId);
    const boilerplateDir = path.join(outputDir, `${projectId}-boilerplate`);

    fs.mkdirSync(outputDir, { recursive: true });

    // Get app type from job (defaults to 'farcaster' for backward compatibility)
    const appType = (job.appType as 'farcaster' | 'web3') || 'farcaster';
    const boilerplateName = appType === 'web3' ? 'web3-boilerplate' : 'minidev-boilerplate';
    logger.log(`🎯 Using ${boilerplateName} for ${appType} app`);

    // Use local boilerplate in development, GitHub API in production
    if (process.env.NODE_ENV === 'production') {
      logger.log(`📋 Fetching ${boilerplateName} from GitHub API (production mode)...`);
      try {
        await fetchBoilerplateFromGitHub(boilerplateDir, appType);
        logger.log("✅ Boilerplate fetched successfully");
      } catch (error) {
        logger.error("❌ Failed to fetch boilerplate:", error);
        throw new Error(`Failed to fetch boilerplate: ${error}`);
      }
    } else {
      // Development mode: use local boilerplate
      logger.log(`📋 Copying from local ${boilerplateName} folder (development mode)...`);
      const localBoilerplatePath = path.join(process.cwd(), '..', boilerplateName);
      try {
        await fs.copy(localBoilerplatePath, boilerplateDir);
        logger.log(`✅ Boilerplate copied successfully from local ${boilerplateName}`);
      } catch (error) {
        logger.error(`❌ Failed to copy local ${boilerplateName}:`, error);
        throw new Error(`Failed to copy boilerplate: ${error}`);
      }
    }

    // Copy boilerplate to user directory
    logger.log("📋 Copying boilerplate to user directory...");
    await fs.copy(boilerplateDir, userDir, {
      filter: (src) => {
        const excludePatterns = [
          "node_modules",
          ".git",
          ".next",
          "pnpm-lock.yaml",
          "package-lock.json",
          "yarn.lock",
          "bun.lockb",
          "pnpm-workspace.yaml",
        ];
        return !excludePatterns.some((pattern) => src.includes(pattern));
      },
    });
    logger.log("✅ Boilerplate copied successfully");

    // Clean up boilerplate directory
    await fs.remove(boilerplateDir);

    // Read boilerplate files
    logger.log("📖 Reading boilerplate files...");
    const boilerplateFiles = await readAllFiles(userDir);
    logger.log(`📁 Found ${boilerplateFiles.length} boilerplate files`);

    // Create LLM caller
    const callLLM = async (
      systemPrompt: string,
      userPrompt: string,
      stageName: string,
      stageType?: keyof typeof STAGE_MODEL_CONFIG
    ): Promise<string> => {
      return callClaudeWithLogging(
        systemPrompt,
        userPrompt,
        stageName,
        stageType
      );
    };

    // Execute enhanced pipeline
    logger.log("🔄 Executing enhanced pipeline...");
    const enhancedResult = await executeEnhancedPipeline(
      prompt,
      boilerplateFiles,
      projectId,
      accessToken,
      callLLM,
      appType, // Pass app type for correct LLM context
      true, // isInitialGeneration
      userDir
    );

    if (!enhancedResult.success) {
      throw new Error(enhancedResult.error || "Enhanced pipeline failed");
    }

    let generatedFiles = enhancedResult.files.map(f => ({
      filename: f.filename,
      content: f.content
    }));

    logger.log(`✅ Successfully generated ${generatedFiles.length} files`);

    // Filter out contracts for non-Web3 apps BEFORE writing to disk
    if (enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3) {
      const originalCount = generatedFiles.length;
      generatedFiles = generatedFiles.filter(file => {
        const isContractFile = file.filename.startsWith('contracts/');
        if (isContractFile) {
          logger.log(`🗑️ Filtering out contract file: ${file.filename}`);
        }
        return !isContractFile;
      });
      logger.log(`📦 Filtered ${originalCount - generatedFiles.length} contract files from generated output`);

      // Also delete contracts directory from disk if it exists
      const contractsDir = path.join(userDir, 'contracts');
      if (await fs.pathExists(contractsDir)) {
        logger.log("🗑️ Removing contracts/ directory from disk...");
        await fs.remove(contractsDir);
        logger.log("✅ Contracts directory removed from disk");
      }
    }

    // Write files to disk (now without contracts for non-Web3 apps)
    logger.log("💾 Writing generated files to disk...");
    await writeFilesToDir(userDir, generatedFiles);
    await saveFilesToGenerated(projectId, generatedFiles);
    logger.log("✅ Files written successfully");

    // NEW: Deploy contracts FIRST for Web3 projects (before creating preview)
    let contractAddresses: { [key: string]: string } | undefined;

    if (enhancedResult.intentSpec?.isWeb3) {
      logger.log("\n" + "=".repeat(70));
      logger.log("🔗 WEB3 PROJECT DETECTED - DEPLOYING CONTRACTS FIRST");
      logger.log("=".repeat(70) + "\n");

      try {
        // Deploy contracts and get real addresses
        contractAddresses = await deployContractsFirst(
          projectId,
          generatedFiles,
          accessToken
        );

        logger.log("✅ Contracts deployed successfully!");
        logger.log("📝 Contract addresses:", JSON.stringify(contractAddresses, null, 2));

        // Inject real contract addresses into files BEFORE deployment
        if (contractAddresses && Object.keys(contractAddresses).length > 0) {
          logger.log("\n" + "=".repeat(70));
          logger.log("💉 INJECTING CONTRACT ADDRESSES INTO FILES");
          logger.log("=".repeat(70) + "\n");

          generatedFiles = updateFilesWithContractAddresses(
            generatedFiles,
            contractAddresses
          );

          // Rewrite files with injected addresses
          await writeFilesToDir(userDir, generatedFiles);
          await saveFilesToGenerated(projectId, generatedFiles);
          logger.log("✅ Contract addresses injected and files updated");
        }
      } catch (contractError) {
        logger.error("\n" + "=".repeat(70));
        logger.error("⚠️  CONTRACT DEPLOYMENT FAILED - CONTINUING WITH PLACEHOLDERS");
        logger.error("=".repeat(70));
        logger.error("Error:", contractError);
        logger.log("📝 App will deploy with placeholder addresses\n");
        // Continue with placeholder addresses - don't fail the entire job
      }
    }

    // Create preview (now with real contract addresses injected if Web3)
    logger.log("🚀 Creating preview...");
    let previewData: Awaited<ReturnType<typeof createPreview>> | undefined;
    let projectUrl: string = `https://${projectId}.${CUSTOM_DOMAIN_BASE}`; // Default fallback URL (custom domain)
    const maxDeploymentRetries = 2; // Allow 1 retry with fixes
    let deploymentAttempt = 0;

    while (deploymentAttempt < maxDeploymentRetries) {
      deploymentAttempt++;
      logger.log(`\n📦 Deployment attempt ${deploymentAttempt}/${maxDeploymentRetries}...`);
      logger.log(`🔍 [RETRY-DEBUG] Starting deployment attempt ${deploymentAttempt}`);
      logger.log(`🔍 [RETRY-DEBUG] maxDeploymentRetries: ${maxDeploymentRetries}`);
      logger.log(`🔍 [RETRY-DEBUG] Files count: ${generatedFiles.length}`);

      try {
        // Skip contract deployment in /deploy endpoint if we already deployed them
        const skipContractsInDeploy = !!contractAddresses; // true if we already deployed contracts
        logger.log(`🔍 [RETRY-DEBUG] skipContractsInDeploy: ${skipContractsInDeploy}`);

        previewData = await createPreview(
          projectId,
          generatedFiles, // Already contains real addresses if Web3
          accessToken,
          enhancedResult.intentSpec?.isWeb3, // Pass isWeb3 flag to preview API
          skipContractsInDeploy, // Skip contracts if we already deployed them
          jobId // Pass jobId for background deployment error reporting
        );

        logger.log(`🔍 [RETRY-DEBUG] Preview data received:`, {
          status: previewData.status,
          hasError: !!previewData.deploymentError,
          hasLogs: !!previewData.deploymentLogs,
          errorLength: previewData.deploymentError?.length || 0,
          logsLength: previewData.deploymentLogs?.length || 0
        });

        // Check if deployment failed with errors
        if (previewData.status === 'deployment_failed' && previewData.deploymentError) {
          logger.error(`❌ Deployment failed on attempt ${deploymentAttempt}`);
          logger.log(`📋 Deployment error: ${previewData.deploymentError}`);
          logger.log(`📋 Deployment logs available: ${previewData.deploymentLogs ? 'YES' : 'NO'}`);
          logger.log(`🔍 [RETRY-DEBUG] Deployment failed, checking if retry is possible...`);
          logger.log(`🔍 [RETRY-DEBUG] deploymentAttempt < maxDeploymentRetries: ${deploymentAttempt < maxDeploymentRetries}`);
          
          // Log to database for visibility
          await updateGenerationJobStatus(jobId, 'processing', {
            status: 'deployment_retry',
            attempt: deploymentAttempt,
            maxAttempts: maxDeploymentRetries,
            error: previewData.deploymentError.substring(0, 500), // Truncate for DB
            hasLogs: !!previewData.deploymentLogs
          });
          logger.log(`🔍 [RETRY-DEBUG] Database status updated with deployment_retry`);
          
          // If this is not the last attempt, try to fix errors
          if (deploymentAttempt < maxDeploymentRetries) {
            logger.log(`🔧 Attempting to fix deployment errors...`);
            logger.log(`🔍 [RETRY-DEBUG] Calling fixDeploymentErrors with:`);
            logger.log(`🔍 [RETRY-DEBUG] - Error length: ${previewData.deploymentError.length}`);
            logger.log(`🔍 [RETRY-DEBUG] - Logs length: ${previewData.deploymentLogs?.length || 0}`);
            logger.log(`🔍 [RETRY-DEBUG] - Files count: ${generatedFiles.length}`);
            logger.log(`🔍 [RETRY-DEBUG] - Project ID: ${projectId}`);
            
            const fixedFiles = await fixDeploymentErrors(
              previewData.deploymentError,
              previewData.deploymentLogs || '', // Use empty string if logs not available
              generatedFiles,
              projectId,
              (job.appType as 'farcaster' | 'web3') || 'farcaster' // Pass app type for correct LLM context
            );

            logger.log(`🔍 [RETRY-DEBUG] fixDeploymentErrors returned ${fixedFiles.length} files`);
            logger.log(`🔍 [RETRY-DEBUG] Files changed: ${fixedFiles.length !== generatedFiles.length ? 'YES (count changed)' : 'checking content...'}`);

            // Update generatedFiles with fixes
            generatedFiles = fixedFiles;

            // Write fixed files back to disk
            logger.log(`🔍 [RETRY-DEBUG] Writing ${fixedFiles.length} fixed files to disk...`);
            await writeFilesToDir(userDir, generatedFiles);
            await saveFilesToGenerated(projectId, generatedFiles);
            logger.log("✅ Fixed files saved, retrying deployment...");
            
            // Log retry to database
            await updateGenerationJobStatus(jobId, 'processing', {
              status: 'deployment_retrying',
              attempt: deploymentAttempt + 1,
              maxAttempts: maxDeploymentRetries,
              fixesApplied: true
            });
            logger.log(`🔍 [RETRY-DEBUG] Database updated with deployment_retrying status`);
            logger.log(`🔍 [RETRY-DEBUG] Continuing to next deployment attempt...`);
            
            // Continue to next iteration to retry deployment
            continue;
          } else {
            // Last attempt failed, mark job as failed
            // DON'T throw here - we're inside a try block and it will be caught
            // Instead, we'll break out of the loop and handle failure after
            logger.error("❌ All deployment attempts failed - breaking out of retry loop");
            const errorDetails = {
              status: 'deployment_failed_all_attempts',
              attempts: deploymentAttempt,
              deploymentError: previewData.deploymentError,
              deploymentLogs: previewData.deploymentLogs ? previewData.deploymentLogs.substring(0, 1000) : undefined
            };
            
            await updateGenerationJobStatus(jobId, 'failed', errorDetails, previewData.deploymentError);
            
            // Set previewData to undefined to indicate failure
            previewData = undefined;
            break; // Exit the retry loop
          }
        }

        // Deployment succeeded
        logger.log("✅ Preview created successfully");
        // Use Vercel URL if available, otherwise fall back to preview URL
        projectUrl = previewData.vercelUrl || previewData.previewUrl || getPreviewUrl(projectId) || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`;
        logger.log(`🎉 Project ready at: ${projectUrl}`);
        logger.log(`🌐 Vercel URL: ${previewData.vercelUrl || 'Not available'}`);
        break; // Exit retry loop on success

      } catch (previewError) {
        logger.error(`❌ Failed to create preview on attempt ${deploymentAttempt}:`, previewError);
        
        // Check if it's a timeout error that should trigger retry
        const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
        const isTimeoutError = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNRESET');
        
        logger.log(`🔍 [RETRY-DEBUG] Error type: ${isTimeoutError ? 'TIMEOUT' : 'OTHER'}`);
        logger.log(`🔍 [RETRY-DEBUG] Error message: ${errorMessage}`);
        logger.log(`🔍 [RETRY-DEBUG] Should retry: ${isTimeoutError && deploymentAttempt < maxDeploymentRetries}`);
        
        // Convert timeout errors to deployment_failed status so retry logic can handle them
        if (isTimeoutError && deploymentAttempt < maxDeploymentRetries) {
          logger.log(`⏱️ Timeout detected, treating as deployment failure and retrying...`);
          
          // Log to database
          await updateGenerationJobStatus(jobId, 'processing', {
            status: 'deployment_timeout',
            attempt: deploymentAttempt,
            maxAttempts: maxDeploymentRetries,
            error: errorMessage
          });
          
          // For timeout errors, just retry without trying to fix
          logger.log(`🔄 Retrying deployment after timeout...`);
          continue;
        } else if (deploymentAttempt >= maxDeploymentRetries) {
          // If this is the last attempt, fail the job
          logger.error("❌ All deployment attempts failed after exception");
          
          const errorDetails = {
            status: 'deployment_failed_exception',
            attempts: deploymentAttempt,
            errorType: isTimeoutError ? 'timeout' : 'other'
          };
          
          await updateGenerationJobStatus(jobId, 'failed', errorDetails, errorMessage);
          
          // Throw error to stop job execution
          throw new Error(`Deployment failed after ${deploymentAttempt} attempts: ${errorMessage}`);
        } else {
          // Non-timeout error on non-final attempt - retry
          logger.log(`🔧 Non-timeout error, retrying...`);
          continue;
        }
      }
    }

    // Track if deployment failed
    const deploymentFailed = !previewData || previewData.status === 'deployment_failed';
    const deploymentError = previewData?.deploymentError || 'Deployment failed';

    // Save project to database (ALWAYS save, even if deployment failed)
    logger.log("💾 Saving project to database...");

    const projectName = enhancedResult.intentSpec
      ? generateProjectName(enhancedResult.intentSpec)
      : `Project ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    // Check if project already exists (from a previous attempt)
    let project = await getProjectById(projectId);

    if (!project) {
      // Create new project
      project = await createProject(
        user.id,
        projectName,
        `AI-generated project: ${userRequest.substring(0, 100)}...`,
        projectUrl,
        projectId
      );
      logger.log("✅ Project created in database");
    } else {
      logger.log("ℹ️ Project already exists in database, updating files");
    }

    // Save files to database (this will replace existing files)
    const allFiles = await readAllFiles(userDir);

    // Filter out contracts/ for non-Web3 apps
    const filesToSave = enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3
      ? allFiles.filter(file => {
          const isContractFile = file.filename.startsWith('contracts/');
          if (isContractFile) {
            logger.log(`🗑️ Excluding contract file from database: ${file.filename}`);
          }
          return !isContractFile;
        })
      : allFiles;

    logger.log(`📦 Files to save: ${filesToSave.length} (excluded ${allFiles.length - filesToSave.length} contract files)`);

    const safeFiles = filesToSave.filter(file => {
      if (file.content.includes('\0') || file.content.includes('\x00')) {
        logger.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
        return false;
      }
      return true;
    });

    await saveProjectFiles(project.id, safeFiles);
    logger.log("✅ Project files saved to database successfully");

    // If deployment failed, mark job as failed and return early
    if (deploymentFailed) {
      logger.error("❌ Deployment failed - marking job as failed");
      
      // Save deployment info with 'failed' status
      try {
        await createDeployment(
          project.id,
          'vercel',
          projectUrl,
          'failed',
          previewData?.deploymentLogs || deploymentError // Save logs or error
        );
        logger.log("✅ Failed deployment info saved to database");
      } catch (dbError) {
        logger.error("⚠️ Failed to save deployment info:", dbError);
      }

      // Update project with basic info
      try {
        await updateProject(project.id, {
          previewUrl: projectUrl,
          name: projectName,
          description: `${userRequest.substring(0, 100)}...`
        });
      } catch (dbError) {
        logger.error("⚠️ Failed to update project:", dbError);
      }

      // Job was already marked as 'failed' in the deployment loop
      // Throw error to prevent marking as completed
      throw new Error(`Deployment failed: ${deploymentError}`);
    }

    // Deployment succeeded - save deployment info
    try {
      logger.log("💾 Saving successful deployment info to database...");
      
      const deploymentUrl = previewData?.vercelUrl || projectUrl;
      logger.log(`🌐 Deployment URL to save: ${deploymentUrl}`);

      // Use contract addresses from our deployment (already injected into files)
      // Fall back to previewData.contractAddresses for backward compatibility
      const deploymentContractAddresses = contractAddresses || previewData?.contractAddresses;

      const deployment = await createDeployment(
        project.id, // Use actual project.id from database record
        'vercel',
        deploymentUrl,
        'success',
        undefined, // buildLogs
        deploymentContractAddresses // Contract addresses (real ones from our deployment)
      );
      logger.log(`✅ Deployment saved to database: ${deployment.id}`);

      if (deploymentContractAddresses && Object.keys(deploymentContractAddresses).length > 0) {
        logger.log(`📝 Contract addresses saved:`, JSON.stringify(deploymentContractAddresses, null, 2));
      }

      // CRITICAL: Update the projects table with deployment URL and metadata
      logger.log("🔄 Updating projects table with deployment URL...");
      await updateProject(project.id, {
        previewUrl: deploymentUrl,
        vercelUrl: previewData?.vercelUrl || undefined, // Save Vercel URL separately
        name: projectName,
        description: `${userRequest.substring(0, 100)}...`
      });
      logger.log(`✅ Projects table updated with URL: ${deploymentUrl}`);
    } catch (deploymentDbError) {
      logger.error("⚠️ Failed to save deployment info:", deploymentDbError);
      // Don't fail the entire job if deployment record fails
    }

    // Update job status to completed (only reached if deployment succeeded)
    const result = {
      projectId,
      url: projectUrl,
      port: previewData?.port || 3000,
      success: true,
      generatedFiles: generatedFiles.map((f) => f.filename),
      totalFiles: generatedFiles.length,
      previewUrl: previewData?.previewUrl || projectUrl,
      vercelUrl: previewData?.vercelUrl,
      projectName,
      contractAddresses: contractAddresses, // Include contract addresses in result
    };

    logger.log(`📝 Updating job ${jobId} status to completed with result:`, {
      projectId: result.projectId,
      vercelUrl: result.vercelUrl,
      totalFiles: result.totalFiles
    });

    try {
      await updateGenerationJobStatus(jobId, "completed", result);
      logger.log(`✅ Job ${jobId} status updated to completed in database`);
    } catch (updateError) {
      logger.error(`❌ Failed to update job status to completed:`, updateError);
      throw updateError; // Re-throw to trigger error handling
    }

    logger.log(`✅ Job ${jobId} completed successfully`);
    logger.log(`🎉 Final result:`, {
      projectId: result.projectId,
      vercelUrl: result.vercelUrl,
      previewUrl: result.previewUrl
    });
}

/**
 * Execute follow-up edit job (existing project)
 */
async function executeFollowUpJob(
  jobId: string,
  job: Awaited<ReturnType<typeof getGenerationJobById>>,
  context: GenerationJobContext
): Promise<void> {
  logger.log(`🔄 Starting follow-up job execution: ${jobId}`);

  const { prompt, existingProjectId: projectId, useDiffBased = true } = context;
  const accessToken = process.env.PREVIEW_AUTH_TOKEN;
  const appType = (job.appType as 'farcaster' | 'web3') || 'farcaster';

  if (!accessToken) {
    throw new Error("Missing preview auth token");
  }

  if (!projectId) {
    throw new Error("Follow-up job requires existingProjectId in context");
  }

  // Get user
  const user = await getUserById(job.userId);
  if (!user) {
    throw new Error(`User ${job.userId} not found`);
  }

  logger.log(`🔧 Processing follow-up job for user: ${user.email || user.id}`);
  logger.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);
  logger.log(`📁 Project ID: ${projectId}`);

  // Get project directory
  const userDir = getProjectDir(projectId);
  const outputDir = process.env.NODE_ENV === 'production' ? '/tmp/generated' : path.join(process.cwd(), 'generated');

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Load existing files
  let currentFiles: { filename: string; content: string }[] = [];

  try {
    // Try reading from disk first
    if (await fs.pathExists(userDir)) {
      logger.log(`📁 Reading files from disk: ${userDir}`);
      currentFiles = await readAllFiles(userDir);
    } else {
      logger.log(`💾 Directory not found on disk, fetching from database for project: ${projectId}`);
      // Fetch files from database
      const dbFiles = await getProjectFiles(projectId);
      currentFiles = dbFiles.map(f => ({
        filename: f.filename,
        content: f.content
      }));

      if (currentFiles.length > 0) {
        logger.log(`✅ Loaded ${currentFiles.length} files from database`);
        // Recreate the directory structure on disk for processing
        logger.log(`📁 Recreating project directory: ${userDir}`);
        await writeFilesToDir(userDir, currentFiles);
        logger.log(`✅ Project files restored to disk`);
      }
    }
  } catch (error) {
    logger.error(`❌ Error reading project files:`, error);
    throw new Error(`Failed to load project files: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (currentFiles.length === 0) {
    throw new Error(`No existing files found for project ${projectId}`);
  }

  logger.log(`✅ Loaded ${currentFiles.length} files for follow-up edit`);

  // Create LLM caller
  const callLLM = async (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ): Promise<string> => {
    return callClaudeWithLogging(
      systemPrompt,
      userPrompt,
      stageName,
      stageType
    );
  };

  // Execute appropriate pipeline
  let result;
  if (useDiffBased) {
    logger.log("🔄 Using diff-based pipeline for follow-up edit");
    result = await executeDiffBasedPipeline(
      prompt,
      currentFiles,
      callLLM,
      {
        enableContextGathering: true,
        enableDiffValidation: true,
        enableLinting: true
      },
      projectId,
      userDir
    );
  } else {
    logger.log("🔄 Using enhanced pipeline for follow-up edit");
    result = await executeEnhancedPipeline(
      prompt,
      currentFiles,
      projectId,
      accessToken,
      callLLM,
      appType,
      false,  // isInitialGeneration = false
      userDir
    );
  }

  // Check if result has diffs (from diff-based pipeline)
  const hasDiffs = 'diffs' in result && result.diffs;
  const diffCount = hasDiffs ? (result as { diffs: unknown[] }).diffs.length : 0;
  logger.log(`✅ Generated ${result.files.length} files${hasDiffs ? ` with ${diffCount} diffs` : ''}`);

  // Write changes to disk
  await writeFilesToDir(userDir, result.files);
  await saveFilesToGenerated(projectId, result.files);

  // Save to database first
  const safeFiles = result.files.filter(file => {
    if (file.content.includes('\0') || file.content.includes('\x00')) {
      logger.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
      return false;
    }
    return true;
  });

  await saveProjectFiles(projectId, safeFiles);
  logger.log("✅ Project files updated in database");

  // Check if project has contracts (Web3) by looking for contracts directory
  const hasContracts = result.files.some(f => 
    f.filename.startsWith('contracts/') && f.filename.endsWith('.sol')
  );
  const isWeb3 = hasContracts;

  // Redeploy to Vercel with updated files
  try {
    logger.log("\n" + "=".repeat(60));
    logger.log("🚀 REDEPLOYING TO VERCEL");
    logger.log("=".repeat(60));
    
    const previewData = await redeployToVercel(
      projectId,
      result.files,
      accessToken,
      isWeb3,
      jobId
    );
    
    logger.log("✅ Vercel deployment successful!");
    logger.log(`🌐 Vercel URL: ${previewData.vercelUrl || 'N/A'}`);

    // Update project with deployment URL (should be same as initial deployment)
    // The URL is stored for redundancy/verification, but it should not change
    // across deployments since we're deploying to the same Vercel project
    if (previewData.vercelUrl) {
      const project = await getProjectById(projectId);
      const urlChanged = project?.vercelUrl !== previewData.vercelUrl;
      
      if (urlChanged) {
        logger.log(`⚠️ Vercel URL changed: ${project?.vercelUrl} → ${previewData.vercelUrl}`);
        logger.log(`   This is unexpected - we should be deploying to the same project`);
      }
      
      await updateProject(projectId, {
        previewUrl: previewData.vercelUrl,
        vercelUrl: previewData.vercelUrl,
      });
      logger.log(`✅ Project deployment URL confirmed: ${previewData.vercelUrl}`);
    }
  } catch (deployError) {
    logger.error("❌ Vercel deployment failed:", deployError);
    // Don't fail the entire job - files are already saved to database
    logger.warn("⚠️ Files are saved to database, but Vercel deployment failed");
  }

  // Store patch for rollback (if diffs available)
  if (hasDiffs && diffCount > 0) {
    try {
      const resultWithDiffs = result as unknown as { diffs: Array<{ filename: string }> };
      logger.log(`📦 Storing patch with ${diffCount} diffs for rollback`);
      const changedFiles = resultWithDiffs.diffs.map(d => d.filename);
      const description = `Updated ${changedFiles.length} file(s): ${changedFiles.join(', ')}`;

      await savePatch(projectId, {
        prompt,
        diffs: resultWithDiffs.diffs,
        changedFiles,
        timestamp: new Date().toISOString(),
      }, description);

      logger.log(`✅ Patch saved for rollback`);
    } catch (patchError) {
      logger.error("⚠️ Failed to save patch:", patchError);
      // Don't fail the job if patch save fails
    }
  }

  // Update job status to completed
  const changedFilenames = result.files.map(f => f.filename);
  const jobResult = {
    success: true,
    projectId,
    files: result.files.map(f => ({ filename: f.filename })),
    diffs: hasDiffs ? (result as { diffs: unknown[] }).diffs : [],
    changedFiles: changedFilenames,
    generatedFiles: changedFilenames, // Add this for frontend compatibility
    previewUrl: getPreviewUrl(projectId),
    totalFiles: result.files.length,
  };

  logger.log(`📝 Updating follow-up job ${jobId} status to completed`);

  try {
    await updateGenerationJobStatus(jobId, "completed", jobResult);
    logger.log(`✅ Follow-up job ${jobId} status updated to completed in database`);
  } catch (updateError) {
    logger.error(`❌ Failed to update follow-up job status:`, updateError);
    throw updateError;
  }

  logger.log(`✅ Follow-up job ${jobId} completed successfully`);
}
