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
  updatePreviewFiles,
  deployContractsFirst,
} from "./previewManager";
import { STAGE_MODEL_CONFIG, ANTHROPIC_MODELS } from "./llmOptimizer";
import { updateFilesWithContractAddresses } from "./contractAddressInjector";

const PREVIEW_API_BASE = process.env.PREVIEW_API_BASE || 'https://minidev.fun';

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
          console.log(`⚠️ Skipping binary file: ${relPath}`);
          continue;
        }

        const sanitizedContent = content
          .replace(/\0/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        files.push({ filename: relPath, content: sanitizedContent });
      } catch (error) {
        console.log(`⚠️ Skipping binary file: ${relPath} (${error})`);
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
async function fetchBoilerplateFromGitHub(targetDir: string) {
  const repoOwner = "Nemil21";
  const repoName = "minidev-boilerplate";
  
  // Fetch repository contents recursively
  async function fetchDirectoryContents(dirPath: string = ""): Promise<void> {
    const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${dirPath}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'minidev-app'
      }
    });
    
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
          console.warn(`⚠️ Failed to fetch file ${itemPath}: ${fileResponse.status}`);
          continue;
        }
        
        const content = await fileResponse.text();
        
        // Check for binary content
        if (content.includes('\0') || content.includes('\x00')) {
          console.log(`⚠️ Skipping binary file: ${itemPath}`);
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

  console.log(`\n🤖 LLM Call - ${stageName}`);
  console.log("  Model:", modelConfig.model);
  console.log("  Max Tokens:", modelConfig.maxTokens);

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
      console.log(`⏱️ Throttling request (attempt ${attempt}), waiting ${throttleDelay}ms...`);
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
              console.log(`⚠️ API ${response.status} error, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              console.log(`⚠️ API ${response.status} error, retrying in ${delay}ms...`);
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
              console.log(`⚠️ Server error ${response.status}, switching to fallback model: ${modelConfig.fallbackModel}`);
              body.model = modelConfig.fallbackModel;
            } else {
              console.log(`⚠️ Server error ${response.status}, retrying in ${delay}ms...`);
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

      console.log("📥 Output:");
      console.log("  Response Time:", endTime - startTime, "ms");
      console.log("  Total Tokens:", totalTokens);
      console.log("  Cost:", actualCost);

      return responseText;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`❌ LLM API Error (${stageName}) after ${maxRetries} attempts:`, error);
        throw error;
      }

      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes("fetch"))
      ) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`⚠️ Network error, retrying in ${delay}ms...`);
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
 * Main worker function to execute a generation job
 */
export async function executeGenerationJob(jobId: string): Promise<void> {
  console.log(`🚀 Starting job execution: ${jobId}`);

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
      console.log(`🔄 Detected follow-up job, routing to follow-up handler`);
      return await executeFollowUpJob(jobId, job, context);
    } else {
      console.log(`🆕 Detected initial generation job, routing to initial generation handler`);
      return await executeInitialGenerationJob(jobId, job, context);
    }
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);

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

    console.log(`🔧 Processing job for user: ${user.email || user.id}`);
    console.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);

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

    console.log(`📁 Project ID: ${projectId}`);

    // Set up directories
    const outputDir = process.env.NODE_ENV === 'production'
      ? '/tmp/generated'
      : path.join(process.cwd(), 'generated');
    const userDir = path.join(outputDir, projectId);
    const boilerplateDir = path.join(outputDir, `${projectId}-boilerplate`);

    fs.mkdirSync(outputDir, { recursive: true });

    // Fetch boilerplate
    console.log("📋 Fetching boilerplate from GitHub API...");
    await fetchBoilerplateFromGitHub(boilerplateDir);
    console.log("✅ Boilerplate fetched successfully");

    // Copy boilerplate to user directory
    console.log("📋 Copying boilerplate to user directory...");
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
    console.log("✅ Boilerplate copied successfully");

    // Clean up boilerplate directory
    await fs.remove(boilerplateDir);

    // Read boilerplate files
    console.log("📖 Reading boilerplate files...");
    const boilerplateFiles = await readAllFiles(userDir);
    console.log(`📁 Found ${boilerplateFiles.length} boilerplate files`);

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
    console.log("🔄 Executing enhanced pipeline...");
    const enhancedResult = await executeEnhancedPipeline(
      prompt,
      boilerplateFiles,
      projectId,
      accessToken,
      callLLM,
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

    console.log(`✅ Successfully generated ${generatedFiles.length} files`);

    // Filter out contracts for non-Web3 apps BEFORE writing to disk
    if (enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3) {
      const originalCount = generatedFiles.length;
      generatedFiles = generatedFiles.filter(file => {
        const isContractFile = file.filename.startsWith('contracts/');
        if (isContractFile) {
          console.log(`🗑️ Filtering out contract file: ${file.filename}`);
        }
        return !isContractFile;
      });
      console.log(`📦 Filtered ${originalCount - generatedFiles.length} contract files from generated output`);

      // Also delete contracts directory from disk if it exists
      const contractsDir = path.join(userDir, 'contracts');
      if (await fs.pathExists(contractsDir)) {
        console.log("🗑️ Removing contracts/ directory from disk...");
        await fs.remove(contractsDir);
        console.log("✅ Contracts directory removed from disk");
      }
    }

    // Write files to disk (now without contracts for non-Web3 apps)
    console.log("💾 Writing generated files to disk...");
    await writeFilesToDir(userDir, generatedFiles);
    await saveFilesToGenerated(projectId, generatedFiles);
    console.log("✅ Files written successfully");

    // NEW: Deploy contracts FIRST for Web3 projects (before creating preview)
    let contractAddresses: { [key: string]: string } | undefined;

    if (enhancedResult.intentSpec?.isWeb3) {
      console.log("\n" + "=".repeat(70));
      console.log("🔗 WEB3 PROJECT DETECTED - DEPLOYING CONTRACTS FIRST");
      console.log("=".repeat(70) + "\n");

      try {
        // Deploy contracts and get real addresses
        contractAddresses = await deployContractsFirst(
          projectId,
          generatedFiles,
          accessToken
        );

        console.log("✅ Contracts deployed successfully!");
        console.log("📝 Contract addresses:", JSON.stringify(contractAddresses, null, 2));

        // Inject real contract addresses into files BEFORE deployment
        if (contractAddresses && Object.keys(contractAddresses).length > 0) {
          console.log("\n" + "=".repeat(70));
          console.log("💉 INJECTING CONTRACT ADDRESSES INTO FILES");
          console.log("=".repeat(70) + "\n");

          generatedFiles = updateFilesWithContractAddresses(
            generatedFiles,
            contractAddresses
          );

          // Rewrite files with injected addresses
          await writeFilesToDir(userDir, generatedFiles);
          await saveFilesToGenerated(projectId, generatedFiles);
          console.log("✅ Contract addresses injected and files updated");
        }
      } catch (contractError) {
        console.error("\n" + "=".repeat(70));
        console.error("⚠️  CONTRACT DEPLOYMENT FAILED - CONTINUING WITH PLACEHOLDERS");
        console.error("=".repeat(70));
        console.error("Error:", contractError);
        console.log("📝 App will deploy with placeholder addresses\n");
        // Continue with placeholder addresses - don't fail the entire job
      }
    }

    // Create preview (now with real contract addresses injected if Web3)
    console.log("🚀 Creating preview...");
    let previewData;
    let projectUrl;

    try {
      // Skip contract deployment in /deploy endpoint if we already deployed them
      const skipContractsInDeploy = !!contractAddresses; // true if we already deployed contracts

      previewData = await createPreview(
        projectId,
        generatedFiles, // Already contains real addresses if Web3
        accessToken,
        enhancedResult.intentSpec?.isWeb3, // Pass isWeb3 flag to preview API
        skipContractsInDeploy // Skip contracts if we already deployed them
      );
      console.log("✅ Preview created successfully");

      projectUrl = getPreviewUrl(projectId) || `https://${projectId}.${PREVIEW_API_BASE}`;
      console.log(`🎉 Project ready at: ${projectUrl}`);
    } catch (previewError) {
      console.error("❌ Failed to create preview:", previewError);

      previewData = {
        url: `${PREVIEW_API_BASE}/p/${projectId}`,
        status: "error",
        port: 3000,
        previewUrl: `${PREVIEW_API_BASE}/p/${projectId}`,
      };

      projectUrl = `${PREVIEW_API_BASE}/p/${projectId}`;
      console.log("⚠️ Using fallback preview URL:", projectUrl);
    }

    // Save project to database
    console.log("💾 Saving project to database...");

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
      console.log("✅ Project created in database");
    } else {
      console.log("ℹ️ Project already exists in database, updating files");
    }

    // Save files to database (this will replace existing files)
    const allFiles = await readAllFiles(userDir);

    // Filter out contracts/ for non-Web3 apps
    const filesToSave = enhancedResult.intentSpec && !enhancedResult.intentSpec.isWeb3
      ? allFiles.filter(file => {
          const isContractFile = file.filename.startsWith('contracts/');
          if (isContractFile) {
            console.log(`🗑️ Excluding contract file from database: ${file.filename}`);
          }
          return !isContractFile;
        })
      : allFiles;

    console.log(`📦 Files to save: ${filesToSave.length} (excluded ${allFiles.length - filesToSave.length} contract files)`);

    const safeFiles = filesToSave.filter(file => {
      if (file.content.includes('\0') || file.content.includes('\x00')) {
        console.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
        return false;
      }
      return true;
    });

    await saveProjectFiles(project.id, safeFiles);
    console.log("✅ Project files saved to database successfully");

    // Save deployment info to database (including contract addresses for web3 projects)
    // Always save deployment, even if vercelUrl is missing
    try {
      console.log("💾 Saving deployment info to database...");
      
      const deploymentUrl = previewData?.vercelUrl || projectUrl;
      console.log(`🌐 Deployment URL to save: ${deploymentUrl}`);

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
      console.log(`✅ Deployment saved to database: ${deployment.id}`);

      if (deploymentContractAddresses && Object.keys(deploymentContractAddresses).length > 0) {
        console.log(`📝 Contract addresses saved:`, JSON.stringify(deploymentContractAddresses, null, 2));
      }

      // CRITICAL: Update the projects table with deployment URL and metadata
      console.log("🔄 Updating projects table with deployment URL...");
      await updateProject(project.id, {
        previewUrl: deploymentUrl,
        name: projectName,
        description: `${userRequest.substring(0, 100)}...`
      });
      console.log(`✅ Projects table updated with URL: ${deploymentUrl}`);
    } catch (deploymentError) {
      console.error("⚠️ Failed to save deployment info:", deploymentError);
      // Don't fail the entire job if deployment record fails
    }

    // Update job status to completed
    const result = {
      projectId,
      url: projectUrl,
      port: previewData.port || 3000,
      success: true,
      generatedFiles: generatedFiles.map((f) => f.filename),
      totalFiles: generatedFiles.length,
      previewUrl: previewData.previewUrl || projectUrl,
      vercelUrl: previewData.vercelUrl,
      projectName,
      contractAddresses: contractAddresses, // Include contract addresses in result
    };

    console.log(`📝 Updating job ${jobId} status to completed with result:`, {
      projectId: result.projectId,
      vercelUrl: result.vercelUrl,
      totalFiles: result.totalFiles
    });

    try {
      await updateGenerationJobStatus(jobId, "completed", result);
      console.log(`✅ Job ${jobId} status updated to completed in database`);
    } catch (updateError) {
      console.error(`❌ Failed to update job status to completed:`, updateError);
      throw updateError; // Re-throw to trigger error handling
    }

    console.log(`✅ Job ${jobId} completed successfully`);
    console.log(`🎉 Final result:`, {
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
  console.log(`🔄 Starting follow-up job execution: ${jobId}`);

  const { prompt, existingProjectId: projectId, useDiffBased = true } = context;
  const accessToken = process.env.PREVIEW_AUTH_TOKEN;

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

  console.log(`🔧 Processing follow-up job for user: ${user.email || user.id}`);
  console.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);
  console.log(`📁 Project ID: ${projectId}`);

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
      console.log(`📁 Reading files from disk: ${userDir}`);
      currentFiles = await readAllFiles(userDir);
    } else {
      console.log(`💾 Directory not found on disk, fetching from database for project: ${projectId}`);
      // Fetch files from database
      const dbFiles = await getProjectFiles(projectId);
      currentFiles = dbFiles.map(f => ({
        filename: f.filename,
        content: f.content
      }));

      if (currentFiles.length > 0) {
        console.log(`✅ Loaded ${currentFiles.length} files from database`);
        // Recreate the directory structure on disk for processing
        console.log(`📁 Recreating project directory: ${userDir}`);
        await writeFilesToDir(userDir, currentFiles);
        console.log(`✅ Project files restored to disk`);
      }
    }
  } catch (error) {
    console.error(`❌ Error reading project files:`, error);
    throw new Error(`Failed to load project files: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (currentFiles.length === 0) {
    throw new Error(`No existing files found for project ${projectId}`);
  }

  console.log(`✅ Loaded ${currentFiles.length} files for follow-up edit`);

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
    console.log("🔄 Using diff-based pipeline for follow-up edit");
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
    console.log("🔄 Using enhanced pipeline for follow-up edit");
    result = await executeEnhancedPipeline(
      prompt,
      currentFiles,
      projectId,
      accessToken,
      callLLM,
      false,  // isInitialGeneration = false
      userDir
    );
  }

  // Check if result has diffs (from diff-based pipeline)
  const hasDiffs = 'diffs' in result && result.diffs;
  const diffCount = hasDiffs ? (result as { diffs: unknown[] }).diffs.length : 0;
  console.log(`✅ Generated ${result.files.length} files${hasDiffs ? ` with ${diffCount} diffs` : ''}`);

  // Write changes to disk
  await writeFilesToDir(userDir, result.files);
  await saveFilesToGenerated(projectId, result.files);

  // Update preview (optional - may fail on Railway)
  try {
    console.log("🔄 Updating preview...");
    await updatePreviewFiles(projectId, result.files, accessToken);
    console.log("✅ Preview updated successfully");
  } catch (previewError) {
    console.warn("⚠️ Preview update failed (expected on Railway):", previewError);
  }

  // Save to database
  const safeFiles = result.files.filter(file => {
    if (file.content.includes('\0') || file.content.includes('\x00')) {
      console.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
      return false;
    }
    return true;
  });

  await saveProjectFiles(projectId, safeFiles);
  console.log("✅ Project files updated in database");

  // Store patch for rollback (if diffs available)
  if (hasDiffs && diffCount > 0) {
    try {
      const resultWithDiffs = result as unknown as { diffs: Array<{ filename: string }> };
      console.log(`📦 Storing patch with ${diffCount} diffs for rollback`);
      const changedFiles = resultWithDiffs.diffs.map(d => d.filename);
      const description = `Updated ${changedFiles.length} file(s): ${changedFiles.join(', ')}`;

      await savePatch(projectId, {
        prompt,
        diffs: resultWithDiffs.diffs,
        changedFiles,
        timestamp: new Date().toISOString(),
      }, description);

      console.log(`✅ Patch saved for rollback`);
    } catch (patchError) {
      console.error("⚠️ Failed to save patch:", patchError);
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

  console.log(`📝 Updating follow-up job ${jobId} status to completed`);

  try {
    await updateGenerationJobStatus(jobId, "completed", jobResult);
    console.log(`✅ Follow-up job ${jobId} status updated to completed in database`);
  } catch (updateError) {
    console.error(`❌ Failed to update follow-up job status:`, updateError);
    throw updateError;
  }

  console.log(`✅ Follow-up job ${jobId} completed successfully`);
}
