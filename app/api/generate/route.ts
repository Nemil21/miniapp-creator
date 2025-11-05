import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { createProject, saveProjectFiles, savePatch, getUserById, getUserByPrivyId, createUser, getProjectById, getProjectFiles } from "../../../lib/database";
import { authenticateRequest } from "../../../lib/auth";
import { logger, logApiRequest, logErrorWithContext } from "../../../lib/logger";
import {
  createPreview,
  updatePreviewFiles,
  saveFilesToGenerated,
  getPreviewUrl,
} from "../../../lib/previewManager";

// Import the API base URL
const PREVIEW_API_BASE = process.env.PREVIEW_API_BASE || 'https://minidev.fun';
const CUSTOM_DOMAIN_BASE = process.env.CUSTOM_DOMAIN_BASE || 'minidev.fun';
import {
  // getOptimizedSystemPrompt,
  // createOptimizedUserPrompt,
  STAGE_MODEL_CONFIG,
  ANTHROPIC_MODELS,
} from "../../../lib/llmOptimizer";
import { executeEnhancedPipeline } from "../../../lib/enhancedPipeline";
import { executeDiffBasedPipeline } from "../../../lib/diffBasedPipeline";
// import { headers } from "next/headers"; // Removed unused import

// Utility: Recursively read all files in a directory, excluding node_modules, .next, and other build artifacts
async function readAllFiles(
  dir: string,
  base = ""
): Promise<{ filename: string; content: string }[]> {
  const files: { filename: string; content: string }[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Exclude node_modules, .next, .git, and other build artifacts
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
      entry.name === "pnpm-workspace.yaml" ||
      entry.name === ".DS_Store" || // Exclude macOS system files
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
        // Try to read as text first
        const content = await fs.readFile(fullPath, "utf8");
        
        // Check for null bytes and other binary content
        if (content.includes('\0') || content.includes('\x00')) {
          console.log(`⚠️ Skipping binary file: ${relPath}`);
          continue;
        }
        
        // Sanitize content for database storage
        const sanitizedContent = content
          .replace(/\0/g, '') // Remove null bytes
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove other control characters
        
        files.push({ filename: relPath, content: sanitizedContent });
      } catch (error) {
        // If reading as UTF-8 fails, it's likely a binary file
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

// Utility: Fetch boilerplate from GitHub API
async function fetchBoilerplateFromGitHub(targetDir: string) {
  const repoOwner = "chetankashetti";
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

// Enhanced LLM caller with stage-specific model selection and retry logic
async function callClaudeWithLogging(
  systemPrompt: string,
  userPrompt: string,
  stageName: string,
  stageType?: keyof typeof STAGE_MODEL_CONFIG
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("Claude API key not set in environment");

  // Select model based on stage type
  let modelConfig = stageType
    ? STAGE_MODEL_CONFIG[stageType]
    : STAGE_MODEL_CONFIG.LEGACY_SINGLE_STAGE;
    
  // Check if this is a retry with increased token limit
  if (stageName.includes('(Retry)') && stageType === 'STAGE_3_CODE_GENERATOR') {
    const increasedTokens = Math.min(modelConfig.maxTokens * 2, 40000);
    modelConfig = {
      ...modelConfig,
      maxTokens: increasedTokens
    } as typeof modelConfig;
  }

  console.log(`\n🤖 LLM Call - ${stageName}`);
  console.log("📤 Input:");
  console.log("  System Prompt Length:", systemPrompt.length, "chars");
  console.log("  User Prompt:", userPrompt);
  console.log("  Model:", modelConfig.model);
  console.log("  Max Tokens:", modelConfig.maxTokens);
  console.log("  Reason:", modelConfig.reason);
  
  // Warn about large prompts that might cause rate limiting or truncation
  if (systemPrompt.length > 50000) {
    const estimatedTokens = Math.ceil(systemPrompt.length / 3.5); // Rough estimate
    console.warn(`⚠️ Large system prompt: ${systemPrompt.length} chars (~${estimatedTokens} tokens)`);
    console.warn(`   This may cause:`);
    console.warn(`   - Rate limiting from API`);
    console.warn(`   - Response truncation if input + output exceeds context window`);
    console.warn(`   - Higher costs per request`);
    if (stageType === 'STAGE_2_PATCH_PLANNER') {
      console.warn(`   💡 Stage 2 now filters to target files only - check targetFiles in Intent Spec`);
    }
  }

  const body = {
    model: modelConfig.model,
    max_tokens: modelConfig.maxTokens,
    temperature: modelConfig.temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  // Retry logic with exponential backoff and request throttling
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Add small delay between requests to prevent rate limiting
    if (attempt > 1) {
      const throttleDelay = Math.min(500 * attempt, 2000); // Max 2 seconds
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

        // Handle specific error types
        if (response.status === 529 || response.status === 429) {
          // Overloaded or rate limited - retry with exponential backoff
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff

            // Try fallback model on last retry
            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              console.log(
                `⚠️ API ${response.status} error (attempt ${attempt}/${maxRetries}), switching to fallback model: ${modelConfig.fallbackModel}`
              );
              body.model = modelConfig.fallbackModel;
            } else {
              console.log(
                `⚠️ API ${response.status} error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
              );
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            console.error(
              `❌ LLM API Error (${stageName}): Max retries exceeded`
            );
            throw new Error(
              `Claude API overloaded after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else if (response.status >= 500) {
          // Server errors - retry
          if (attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1);

            // Try fallback model on last retry
            if (attempt === maxRetries - 1 && modelConfig.fallbackModel) {
              console.log(
                `⚠️ Server error ${response.status} (attempt ${attempt}/${maxRetries}), switching to fallback model: ${modelConfig.fallbackModel}`
              );
              body.model = modelConfig.fallbackModel;
            } else {
              console.log(
                `⚠️ Server error ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
              );
            }

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          } else {
            console.error(
              `❌ LLM API Error (${stageName}): Max retries exceeded`
            );
            throw new Error(
              `Claude API server error after ${maxRetries} attempts. Please try again later.`
            );
          }
        } else {
          // Client errors - don't retry
          console.error(
            `❌ LLM API Error (${stageName}):`,
            response.status,
            errorText
          );
          throw new Error(`Claude API error: ${response.status} ${errorText}`);
        }
      }

      const responseData = await response.json();
      const endTime = Date.now();

      const responseText = responseData.content[0]?.text || "";
      
      // Extract actual token usage from API response
      const inputTokens = responseData.usage?.input_tokens || 0;
      const outputTokens = responseData.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      
      // Calculate actual cost based on real token usage
      const actualCost = calculateActualCost(inputTokens, outputTokens, modelConfig.model);

      console.log("📥 Output:");
      console.log("  Response Length:", responseText.length, "chars");
      console.log("  Response Time:", endTime - startTime, "ms");
      console.log("  Token Usage:");
      console.log("    Input Tokens:", inputTokens);
      console.log("    Output Tokens:", outputTokens);
      console.log("    Total Tokens:", totalTokens);
      console.log("  Actual Cost:", actualCost);
      console.log(
        "  Raw Response Preview:",
        responseText.substring(0, 100) + "..."
      );

      // Log token usage summary for analysis
      console.log("📊 Token Usage Summary:");
      console.log(`    Model: ${modelConfig.model}`);
      console.log(`    Stage: ${stageName}`);
      console.log(`    Input/Output Ratio: ${inputTokens > 0 ? (outputTokens / inputTokens).toFixed(2) : 'N/A'}`);
      console.log(`    Efficiency: ${totalTokens > 0 ? ((responseText.length / totalTokens) * 4).toFixed(2) : 'N/A'} chars/token`);

      return responseText;
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(
          `❌ LLM API Error (${stageName}) after ${maxRetries} attempts:`,
          error
        );
        throw error;
      }

      // For network errors, retry
      if (
        error instanceof TypeError ||
        (error instanceof Error && error.message.includes("fetch"))
      ) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(
          `⚠️ Network error (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, don't retry
      throw error;
    }
  }

  throw new Error(
    `Failed to get response from Claude API after ${maxRetries} attempts`
  );
}

// Cost calculation helper using actual token counts from API response
function calculateActualCost(
  inputTokens: number,
  outputTokens: number,
  model: string
): string {
  let costPer1MInput = 0;
  let costPer1MOutput = 0;

  switch (model) {
    case ANTHROPIC_MODELS.FAST:
      costPer1MInput = 0.25; // $0.25 per 1M input tokens
      costPer1MOutput = 1.25; // $1.25 per 1M output tokens
      break;
    case ANTHROPIC_MODELS.BALANCED:
      costPer1MInput = 3; // $3 per 1M input tokens
      costPer1MOutput = 15; // $15 per 1M output tokens
      break;
    case ANTHROPIC_MODELS.POWERFUL:
      costPer1MInput = 15; // $15 per 1M input tokens
      costPer1MOutput = 75; // $75 per 1M output tokens
      break;
  }

  const inputCost = (inputTokens / 1000000) * costPer1MInput;
  const outputCost = (outputTokens / 1000000) * costPer1MOutput;
  const totalCost = inputCost + outputCost;
  
  return `$${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`;
}

// Legacy cost estimation helper (kept for backward compatibility)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function estimateCost(
  inputChars: number,
  outputChars: number,
  model: string
): string {
  // Rough estimation: 1 token ≈ 4 characters
  const estimatedInputTokens = Math.ceil(inputChars / 4);
  const estimatedOutputTokens = Math.ceil(outputChars / 4);
  
  return calculateActualCost(estimatedInputTokens, estimatedOutputTokens, model);
}

function generateProjectName(intentSpec: { feature: string; reason?: string }): string {
  // Use the LLM-generated feature name as the base
  let projectName = intentSpec.feature;
  
  // Clean up the feature name
  projectName = projectName
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Capitalize words
  const words = projectName.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  );
  
  projectName = words.join(' ');
  
  // Add "App" suffix if it doesn't already contain common app-related terms
  const appTerms = ['app', 'application', 'miniapp', 'mini app', 'dashboard', 'platform', 'tool', 'game', 'player', 'gallery', 'blog', 'store', 'shop'];
  const hasAppTerm = appTerms.some(term => projectName.toLowerCase().includes(term));
  
  if (!hasAppTerm) {
    projectName += ' App';
  }
  
  // Handle special cases for better naming
  if (projectName.toLowerCase().includes('bootstrap') || projectName.toLowerCase().includes('template')) {
    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Miniapp ${timeStr}`;
  }
  
  return projectName;
}

export async function POST(request: NextRequest) {
  const requestId = uuidv4();
  const startTime = Date.now();

  try {
    logApiRequest('POST', '/api/generate', { requestId, startTime });

    // TEST MODE: Quick return for debugging duplicate calls
    const testMode = request.headers.get("X-Test-Quick-Return") === "true";
    if (testMode) {
      console.log(`🧪 TEST MODE: Request ${requestId} - Returning after 30 seconds`);
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

      return NextResponse.json({
        projectId: uuidv4(),
        url: "https://test-mode.example.com",
        port: 3000,
        success: true,
        generatedFiles: ["test.ts"],
        pipeline: "test-mode",
        changesApplied: true,
        reason: "Test mode - quick return",
        totalFiles: 1,
        testMode: true,
        requestId
      });
    }

    // ASYNC MODE: Return immediately with job ID (recommended for production)
    const useAsyncProcessing = request.headers.get("X-Use-Async-Processing") === "true" ||
                                process.env.USE_ASYNC_PROCESSING === "true";

    if (useAsyncProcessing) {
      console.log(`🔄 ASYNC MODE: Creating job and returning immediately`);

      // Import async dependencies
      const { createGenerationJob } = await import("../../../lib/database");

      // Authenticate the request
      const bypassAuth = request.headers.get("X-Bypass-Auth") === "true";
      const testUserId = request.headers.get("X-Test-User-Id");

      let user;
      let isAuthorized;

      if (bypassAuth && testUserId) {
        logger.warn("AUTH BYPASS ENABLED FOR TESTING", { requestId, testUserId });

        // For testing: Ensure test user exists in database before creating job
        // (generation_jobs table has foreign key constraint on user_id)
        try {
          let dbUser = await getUserByPrivyId(testUserId);
          if (!dbUser) {
            logger.info("Creating test user in database", { requestId, testUserId });
            dbUser = await createUser(
              testUserId, // Use UUID as privyUserId
              "test@example.com",
              "Test User",
              undefined
            );
            logger.info("Test user created", { requestId, userId: dbUser.id });
          }

          user = {
            id: dbUser.id,
            privyUserId: dbUser.privyUserId,
            email: dbUser.email ?? "test@example.com",
            displayName: dbUser.displayName ?? "Test User",
          };
        } catch (dbError) {
          logger.error("Failed to create/get test user", { requestId, error: dbError });
          throw new Error(`Failed to create test user: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }

        isAuthorized = true;
      } else {
        const authResult = await authenticateRequest(request);
        user = authResult.user;
        isAuthorized = authResult.isAuthorized;

        if (!isAuthorized || !user) {
          return NextResponse.json(
            { error: authResult.error || "Authentication required" },
            { status: 401 }
          );
        }
      }

      const { prompt, useMultiStage = true, projectId: existingProjectId } = await request.json();

      if (!prompt) {
        return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
      }

      console.log(`📝 Creating generation job for user: ${user.email || user.id}`);
      console.log(`📋 Prompt: ${prompt.substring(0, 100)}...`);

      // Create job in database
      const job = await createGenerationJob(
        user.id,
        prompt,
        {
          prompt,
          existingProjectId,
          useMultiStage,
        },
        existingProjectId
      );

      console.log(`✅ Job created with ID: ${job.id}`);

      // Trigger background processing asynchronously
      // Note: This uses fetch to call the worker endpoint without waiting
      const workerToken = process.env.WORKER_AUTH_TOKEN || 'dev-worker-token';
      const workerUrl = process.env.WORKER_URL || `${request.nextUrl.origin}/api/jobs/process`;

      console.log(`🔧 Triggering background worker at: ${workerUrl}`);
      console.log(`🔑 Using worker token: ${workerToken ? 'Bearer ' + workerToken.substring(0, 10) + '...' : 'NOT SET'}`);

      // Fire and forget - don't await this
      fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ jobId: job.id }),
      }).catch(error => {
        console.error('⚠️ Failed to trigger background worker:', error);
        // Job will be picked up by scheduled worker polling
      });

      // Return immediately with 202 Accepted and job ID
      return NextResponse.json({
        accepted: true,
        jobId: job.id,
        status: 'pending',
        message: 'Generation job created and processing started',
        pollUrl: `/api/jobs/${job.id}`,
        estimatedTime: '5-10 minutes',
      }, {
        status: 202, // 202 Accepted
        headers: {
          'Location': `/api/jobs/${job.id}`,
        },
      });
    }
    
    // Check for auth bypass (testing only)
    const bypassAuth = request.headers.get("X-Bypass-Auth") === "true";
    const testUserId = request.headers.get("X-Test-User-Id");

    let user;
    let isAuthorized;

    if (bypassAuth && testUserId) {
      logger.warn("AUTH BYPASS ENABLED FOR TESTING", { requestId, testUserId });

      // Check if test user exists in database, create if not
      try {
        let dbUser = await getUserById(testUserId);
        if (!dbUser) {
          logger.info("Creating test user in database", { requestId, testUserId });
          dbUser = await createUser(
            testUserId, // Use UUID as privyUserId too
            "test@example.com",
            "Test User",
            undefined
          );
          logger.info("Test user created", { requestId, userId: dbUser.id });
        }

        user = {
          id: dbUser.id,
          privyUserId: dbUser.privyUserId,
          email: dbUser.email ?? "test@example.com",
          displayName: dbUser.displayName ?? "Test User",
        };
      } catch (dbError) {
        console.error("⚠️ Failed to create/get test user:", dbError);
        // Fallback to mock user (database save will be skipped)
        user = {
          id: testUserId,
          privyUserId: testUserId,
          email: "test@example.com",
          displayName: "Test User",
        };
      }

      isAuthorized = true;
    } else {
      const authResult = await authenticateRequest(request);
      user = authResult.user;
      isAuthorized = authResult.isAuthorized;

      if (!isAuthorized || !user) {
        return NextResponse.json(
          { error: authResult.error || "Authentication required" },
          { status: 401 }
        );
      }
    }

    const { prompt, useMultiStage = true, projectId: existingProjectId } = await request.json();
    const accessToken = process.env.PREVIEW_AUTH_TOKEN;
    console.log("🔑 Preview auth token:", accessToken);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing preview auth token" },
        { status: 401 }
      );
    }

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    console.log(`🚀 Starting project generation for prompt: ${prompt}`);
    console.log(
      `🔧 Using ${useMultiStage ? "multi-stage" : "single-stage"} pipeline`
    );

    // Extract the core user request from the comprehensive prompt
    const lines = prompt.split("\n");
    let userRequest = prompt;

    // Check if this is a confirmed project prompt
    if (prompt.includes("BUILD THIS MINIAPP:")) {
      const buildMatch = prompt.match(/BUILD THIS MINIAPP:\s*(.+?)(?:\n|$)/);
      if (buildMatch) {
        userRequest = buildMatch[1].trim();
      }
      console.log(`📋 Confirmed Project Request: ${userRequest}`);
      console.log(`📋 Full Confirmed Prompt: ${prompt.substring(0, 300)}...`);
    } else {
      const userMatch = lines.find((line: string) =>
        line.startsWith("User wants to create:")
      );
      if (userMatch) {
        userRequest = userMatch;
      }
      console.log(`📋 User Request: ${userRequest}`);
      console.log(`📋 Full Prompt: ${prompt.substring(0, 200)}...`);
    }

    // Use existing project ID if provided (for chat preservation), otherwise generate new one
    const projectId = existingProjectId || uuidv4();

    if (existingProjectId) {
      console.log(`📦 Using existing project ID from chat: ${existingProjectId}`);
    } else {
      console.log(`🆕 Generated new project ID: ${projectId}`);
    }
    
    // Use local generated folder for development, /tmp/generated for production
    const outputDir = process.env.NODE_ENV === 'production' 
      ? '/tmp/generated' 
      : path.join(process.cwd(), 'generated');
    const userDir = path.join(outputDir, projectId);
    const boilerplateDir = path.join(outputDir, `${projectId}-boilerplate`);
    
    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`📁 Project ID: ${projectId}`);
    console.log(`📁 User directory: ${userDir}`);
    console.log(`📁 Boilerplate directory: ${boilerplateDir}`);

    // Use local boilerplate in development, GitHub API in production
    if (process.env.NODE_ENV === 'production') {
      console.log("📋 Fetching boilerplate from GitHub API (production mode)...");
      try {
        await fetchBoilerplateFromGitHub(boilerplateDir);
        console.log("✅ Boilerplate fetched successfully");
      } catch (error) {
        console.error("❌ Failed to fetch boilerplate:", error);
        throw new Error(`Failed to fetch boilerplate: ${error}`);
      }
    } else {
      // Development mode: use local boilerplate
      console.log("📋 Copying from local minidev-boilerplate folder (development mode)...");
      const localBoilerplatePath = path.join(process.cwd(), '..', 'minidev-boilerplate');
      try {
        await fs.copy(localBoilerplatePath, boilerplateDir);
        console.log("✅ Boilerplate copied successfully from local folder");
      } catch (error) {
        console.error("❌ Failed to copy local boilerplate:", error);
        throw new Error(`Failed to copy boilerplate: ${error}`);
      }
    }

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

    // Clean up cloned boilerplate directory
    console.log("🧹 Cleaning up boilerplate directory...");
    try {
      await fs.remove(boilerplateDir);
      console.log("✅ Boilerplate directory cleaned up");
    } catch (error) {
      console.warn("⚠️ Failed to clean up boilerplate directory:", error);
    }

    // Read boilerplate files
    console.log("📖 Reading boilerplate files...");
    const boilerplateFiles = await readAllFiles(userDir);
    console.log(`📁 Found ${boilerplateFiles.length} boilerplate files`);

    // Generate files using selected pipeline
    console.log("🔄 Using multi-stage pipeline...");

    // Create LLM caller function for multi-stage pipeline
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

    // Use enhanced pipeline with context gathering for initial generation
    const enhancedResult = await executeEnhancedPipeline(
      prompt,
      boilerplateFiles,
      projectId,
      accessToken,
      callLLM,
      true, // isInitialGeneration = true for POST requests
      userDir // projectDir
    );

    if (!enhancedResult.success) {
      throw new Error(enhancedResult.error || "Enhanced pipeline failed");
    }

    const generatedFiles = enhancedResult.files.map(f => ({
      filename: f.filename,
      content: f.content
    }));

    // Check if the pipeline returned boilerplate files as-is (no changes needed)
    let pipelineResult: { needsChanges: boolean; reason?: string } = {
      needsChanges: true,
    };

    // Check if the pipeline returned boilerplate files as-is (no changes needed)
    const isBoilerplateOnly =
      generatedFiles.length === boilerplateFiles.length &&
      generatedFiles.every((file) =>
        boilerplateFiles.some(
          (bf) => bf.filename === file.filename && bf.content === file.content
        )
      );

    if (isBoilerplateOnly) {
      pipelineResult = {
        needsChanges: false,
        reason:
          "Basic miniapp requested, boilerplate provides all needed functionality",
      };
      console.log("📋 No changes needed - using boilerplate as-is");
    } else {
      pipelineResult = {
        needsChanges: true,
        reason: "Custom functionality requested, modifications applied",
      };
      console.log("📋 Changes applied - custom functionality added");
    }

    console.log(`✅ Successfully generated ${generatedFiles.length} files`);
    console.log(
      `📋 Pipeline Result: ${
        pipelineResult.needsChanges ? "Changes Applied" : "No Changes Needed"
      }`
    );
    if (pipelineResult.reason) {
      console.log(`📝 Reason: ${pipelineResult.reason}`);
    }

    // Validate generated files
    if (!Array.isArray(generatedFiles) || generatedFiles.length === 0) {
      throw new Error("LLM returned invalid or empty file array");
    }

    for (const file of generatedFiles) {
      if (!file.filename || !file.content) {
        throw new Error(`Invalid file object: ${JSON.stringify(file)}`);
      }
    }

    // Write files to disk
    console.log("💾 Writing generated files to disk...");
    await writeFilesToDir(userDir, generatedFiles);
    console.log("✅ Files written successfully");

    // Save files to generated directory
    console.log("💾 Saving files to generated directory...");
    await saveFilesToGenerated(projectId, generatedFiles);
    console.log("✅ Files saved to generated directory");

    // Create preview with all generated files
    console.log("🚀 Creating preview with generated files...");
    let previewData;
    let projectUrl;

    try {
      previewData = await createPreview(
        projectId,
        generatedFiles,
        accessToken
      );
      console.log("✅ Preview created successfully");

      // Get the full preview URL
      const previewUrl = getPreviewUrl(projectId);
      console.log(`🌐 Preview URL: ${previewUrl}`);
      console.log(
        `📊 Preview Status: ${previewData.status}, Port: ${previewData.port}`
      );

      projectUrl = getPreviewUrl(projectId) || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`;
      console.log(`🎉 Project ready at: ${projectUrl}`);
    } catch (previewError) {
      console.error("❌ Failed to create preview:", previewError);
      console.error("❌ Preview error details:", previewError instanceof Error ? previewError.message : String(previewError));

      // Create a fallback preview data object
      previewData = {
        url: `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
        status: "error",
        port: 3000,
        previewUrl: `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
      };

      projectUrl = `https://${projectId}.${CUSTOM_DOMAIN_BASE}`;

      console.log("⚠️ Using fallback preview URL:", projectUrl);
      console.log("⚠️ Continuing with project creation despite preview error");
    }

    // Handle package.json changes (dependencies will be handled by preview server)
    const packageJsonChanged = generatedFiles.some(
      (f) => f.filename === "package.json"
    );

    if (packageJsonChanged) {
      console.log(
        "📦 Package.json changed - dependencies will be handled by the preview server"
      );
    }

    // Save project to database
    try {
      console.log("💾 Saving project to database...");
      
      // Generate meaningful project name based on LLM-generated intent
      const projectName = enhancedResult.intentSpec 
        ? generateProjectName(enhancedResult.intentSpec)
        : `Project ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      
      const project = await createProject(
        user.id, // Use actual user ID from authentication
        projectName,
        `AI-generated project: ${userRequest.substring(0, 100)}...`,
        projectUrl,
        projectId // Pass the custom project ID
      );
      
      // Save ALL project files to database (boilerplate + generated)
      const allFiles = await readAllFiles(userDir);
      console.log(`📁 Found ${allFiles.length} files to save to database`);
      
      // Filter out any files that might cause encoding issues
      const safeFiles = allFiles.filter(file => {
        // Check for potential encoding issues
        if (file.content.includes('\0') || file.content.includes('\x00')) {
          console.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
          return false;
        }
        return true;
      });
      
      console.log(`📁 Saving ${safeFiles.length} safe files to database`);
      await saveProjectFiles(project.id, safeFiles);
      
      console.log("✅ Project saved to database successfully");
    } catch (dbError) {
      console.error("⚠️ Failed to save project to database:", dbError);
      // Don't fail the request if database save fails
    }

    return NextResponse.json({
      projectId,
      url: projectUrl,
      port: previewData.port || 3000,
      success: true,
      generatedFiles: generatedFiles.map((f) => f.filename),
      pipeline: useMultiStage ? "multi-stage" : "single-stage",
      changesApplied: pipelineResult.needsChanges,
      reason: pipelineResult.reason,
      totalFiles: generatedFiles.length,
      previewUrl: previewData.previewUrl || projectUrl,
      vercelUrl: previewData.vercelUrl,
      aliasSuccess: previewData.aliasSuccess,
      isNewDeployment: previewData.isNewDeployment,
      hasPackageChanges: previewData.hasPackageChanges,
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logErrorWithContext(err as Error, 'Project generation request', requestId);
    logger.error("Project generation failed", {
      requestId,
      duration,
      error: err instanceof Error ? err.message : String(err)
    });

    return NextResponse.json(
      {
        error: "Failed to generate project",
        details: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error && err.stack ? err.stack : undefined,
        requestId,
        duration
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = uuidv4();
  const startTime = Date.now();
  
  try {
    logApiRequest('PATCH', '/api/generate', { requestId, startTime });
    // Check for auth bypass (testing only)
    const bypassAuth = request.headers.get("X-Bypass-Auth") === "true";
    const testUserId = request.headers.get("X-Test-User-Id");

    let user;
    let isAuthorized;

    if (bypassAuth && testUserId) {
      console.log("⚠️ AUTH BYPASS ENABLED FOR TESTING");

      // Check if test user exists in database, create if not
      try {
        let dbUser = await getUserById(testUserId);
        if (!dbUser) {
          console.log("🔧 Creating test user in database...");
          try {
            dbUser = await createUser(
              testUserId, // Use UUID as privyUserId too
              "test@example.com",
              "Test User",
              undefined
            );
            console.log(`✅ Test user created with ID: ${dbUser.id}`);
          } catch (createError: unknown) {
            // Handle duplicate key error gracefully
            if (createError && typeof createError === 'object' && 'code' in createError && 'constraint' in createError && 
                createError.code === '23505' && createError.constraint === 'users_privy_user_id_unique') {
              console.log("ℹ️ Test user already exists, fetching from database...");
              dbUser = await getUserById(testUserId);
            } else {
              throw createError;
            }
          }
        }

        user = {
          id: dbUser.id,
          privyUserId: dbUser.privyUserId,
          email: dbUser.email ?? "test@example.com",
          displayName: dbUser.displayName ?? "Test User",
        };
      } catch (dbError) {
        console.error("⚠️ Failed to create/get test user:", dbError);
        // Fallback to mock user (database save will be skipped)
        user = {
          id: testUserId,
          privyUserId: testUserId,
          email: "test@example.com",
          displayName: "Test User",
        };
      }

      isAuthorized = true;
    } else {
      const authResult = await authenticateRequest(request);
      user = authResult.user;
      isAuthorized = authResult.isAuthorized;

      if (!isAuthorized || !user) {
        return NextResponse.json(
          { error: authResult.error || "Authentication required" },
          { status: 401 }
        );
      }
    }

    const { projectId, prompt, stream = false, useDiffBased = true } = await request.json();
    const accessToken = process.env.PREVIEW_AUTH_TOKEN;
    console.log("🔑 Preview auth token:", accessToken);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing preview auth token" },
        { status: 401 }
      );
    }

    if (!projectId || !prompt) {
      return NextResponse.json(
        { error: "Missing projectId or prompt" },
        { status: 400 }
      );
    }

    // Use local generated folder for development, /tmp/generated for production
    const outputDir = process.env.NODE_ENV === 'production'
      ? '/tmp/generated'
      : path.join(process.cwd(), 'generated');
    const userDir = path.join(outputDir, projectId);

    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // Try to read files from disk first, fall back to database if directory doesn't exist
    let currentFiles: { filename: string; content: string }[] = [];

    try {
      // Check if the directory exists
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
      // Try database as final fallback
      try {
        console.log(`💾 Attempting database fallback for project: ${projectId}`);
        const dbFiles = await getProjectFiles(projectId);
        currentFiles = dbFiles.map(f => ({
          filename: f.filename,
          content: f.content
        }));

        if (currentFiles.length > 0) {
          console.log(`✅ Loaded ${currentFiles.length} files from database (fallback)`);
          // Recreate the directory structure on disk for processing
          await writeFilesToDir(userDir, currentFiles);
          console.log(`✅ Project files restored to disk (fallback)`);
        }
      } catch (dbError) {
        console.error(`❌ Database fallback also failed:`, dbError);
        throw error; // Re-throw the original error
      }
    }

    if (currentFiles.length === 0) {
      return NextResponse.json(
        { error: "No existing files found for project" },
        { status: 404 }
      );
    }

    // ASYNC MODE: Create job and return immediately (non-streaming only)
    const useAsyncProcessing = request.headers.get("X-Use-Async-Processing") === "true" ||
                                process.env.USE_ASYNC_PROCESSING === "true";

    if (useAsyncProcessing && !stream) {
      console.log(`🔄 ASYNC MODE: Creating follow-up edit job for project ${projectId}`);

      // Import async dependencies
      const { createGenerationJob } = await import("../../../lib/database");

      // Create job for follow-up edit
      const jobContext = {
        prompt,
        existingProjectId: projectId,
        isFollowUp: true,        // Flag to identify this as a follow-up edit
        useDiffBased,            // Whether to use diff-based pipeline
      };

      const job = await createGenerationJob(
        user.id,
        prompt,
        jobContext,
        projectId  // Link to existing project
      );

      console.log(`✅ Follow-up job created with ID: ${job.id}`);

      // Trigger background processing
      const workerToken = process.env.WORKER_AUTH_TOKEN || 'dev-worker-token';
      const workerUrl = process.env.WORKER_URL || `${request.nextUrl.origin}/api/jobs/process`;

      console.log(`🔧 Triggering background worker at: ${workerUrl}`);
      console.log(`🔑 Using worker token: ${workerToken ? 'Bearer ' + workerToken.substring(0, 10) + '...' : 'NOT SET'}`);

      // Fire and forget - don't await this
      fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ jobId: job.id }),
      }).catch(error => {
        console.error('⚠️ Failed to trigger background worker:', error);
        // Job will be picked up by scheduled worker polling
      });

      // Return immediately with 202 Accepted and job ID
      return NextResponse.json({
        accepted: true,
        jobId: job.id,
        status: 'pending',
        message: 'Follow-up edit job created and processing started',
        pollUrl: `/api/jobs/${job.id}`,
        estimatedTime: '2-5 minutes',
        projectId,
      }, {
        status: 202, // 202 Accepted
        headers: {
          'Location': `/api/jobs/${job.id}`,
        },
      });
    }

    if (stream) {
      // Handle streaming response for chat-like interaction
      const systemPrompt = `You are an AI assistant helping to modify a Farcaster miniapp. 
      
      IMPORTANT: Respond ONLY in natural, conversational language. Do NOT mention technical programming details, file names, code structure, or technical implementation details. The user doesn't understand programming, so describe everything in plain English.
      
      Your role is to:
      1. **Understand the user's request** and analyze what they want to achieve
      2. **Propose a complete solution** in simple terms
      3. **Explain what the changes will do** for users
      4. **Provide context** about why these changes are beneficial
      
      Guidelines:
      - **Use natural language only**: No technical jargon, programming terms, or file references
      - **Focus on user experience**: Describe what users will see and do
      - **Explain in simple terms**: Use everyday language to describe features
      - **Be helpful**: Explain the benefits and reasoning behind your approach
      - **Be conversational**: Write as if you're explaining to a friend
      
      Example response:
      "I'll help you add user login to your miniapp. Here's what I'll add:
      - A simple login button that connects to users' wallets
      - A user profile section showing their wallet address
      - A logout option to disconnect their wallet
      - Protection for certain features so only logged-in users can access them
      
      This will give users a secure way to sign in with their crypto wallet. Should I proceed with these changes?"
      
      The user wants to make changes to their project. Provide a conversational response about what changes you'll make.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.CLAUDE_API_KEY!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 2000,
          temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      return new Response(response.body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
        },
      });
    } else if (useDiffBased) {
      // Handle diff-based updates
      console.log(`🔄 Diff-based update for project ${projectId}`);
      console.log("User prompt:", prompt);

      // Execute diff-based pipeline
      const result = await executeDiffBasedPipeline(
        prompt,
        currentFiles,
        callClaudeWithLogging,
        {
          enableContextGathering: true,
          enableDiffValidation: true,
          enableLinting: true
        },
        projectId,
        userDir
      );

      console.log(`✅ Generated ${result.files.length} files with ${result.diffs.length} diffs`);

      // Check validation result and retry with LLM if there are errors
      let finalResult = result;
      const maxRetries = 2;
      let retryCount = 0;
      
      while (finalResult.validationResult && !finalResult.validationResult.success && retryCount < maxRetries) {
        retryCount++;
        console.log(`\n⚠️  Validation failed on attempt ${retryCount}. Sending errors to LLM for fixing...`);
        console.log(`❌ Errors: ${finalResult.validationResult.errors.length}`);
        console.log(`⚠️  Warnings: ${finalResult.validationResult.warnings.length}`);
        
        // Format validation errors with file content for better context
        const errorsByFile = new Map<string, Array<{ file: string; line?: number; column?: number; message: string; severity: string }>>();
        for (const err of finalResult.validationResult.errors) {
          if (!errorsByFile.has(err.file)) {
            errorsByFile.set(err.file, []);
          }
          errorsByFile.get(err.file)!.push(err);
        }
        
        // Build detailed error context with full file content
        const errorDetails: string[] = [];
        for (const [filename, errors] of errorsByFile.entries()) {
          const file = finalResult.files.find(f => f.filename === filename);
          if (file) {
            errorDetails.push(`\n### ${filename}\n`);
            errorDetails.push(`Errors in this file:`);
            errors.forEach(err => {
              errorDetails.push(`  - Line ${err.line}:${err.column}: ${err.message}`);
            });
            errorDetails.push(`\nFull file content (errors marked with >>>):\n`);
            
            // Send the complete file with error lines marked
            const lines = file.content.split('\n');
            const errorLines = new Set(errors.map(e => (e.line ?? 1) - 1));
            lines.forEach((line, idx) => {
              const marker = errorLines.has(idx) ? '>>> ' : '    ';
              errorDetails.push(`${marker}${idx + 1}: ${line}`);
            });
          } else {
            errorDetails.push(`\n### ${filename}\n`);
            errorDetails.push(`Errors: ${errors.map(e => `Line ${e.line ?? '?'}: ${e.message}`).join(', ')}`);
          }
        }
        
        const errorContext = errorDetails.join('\n');
        
        // Create retry prompt with detailed error context
        const retryPrompt = `${prompt}\n\n⚠️  VALIDATION ERRORS DETECTED - PLEASE FIX:\n\nThe previous generation had ${finalResult.validationResult.errors.length} compilation errors. Here are the errors with code context:\n${errorContext}\n\nPlease analyze these errors carefully and fix them. Common issues to check:\n- Missing type imports\n- Incorrect type definitions\n- JSX syntax errors (use {{'>'}} instead of > in JSX)\n- Type mismatches\n\nRegenerate the corrected code with all errors fixed.`;
        
        console.log(`🔄 Retry ${retryCount}/${maxRetries}: Calling LLM with error context...`);
        
        // Retry with error context
        try {
          finalResult = await executeDiffBasedPipeline(
            retryPrompt,
            currentFiles,
            callClaudeWithLogging,
            {
              enableContextGathering: true,
              enableDiffValidation: true,
              enableLinting: true
            },
            projectId,
            userDir
          );
          
          console.log(`✅ Retry ${retryCount} generated ${finalResult.files.length} files`);
          
          if (finalResult.validationResult?.success) {
            console.log(`🎉 Validation passed on retry ${retryCount}!`);
            break;
          }
        } catch (retryError) {
          console.error(`❌ Retry ${retryCount} failed:`, retryError);
          break; // Stop retrying on errors
        }
      }
      
      // If still failing after retries, log but continue (save best attempt)
      if (finalResult.validationResult && !finalResult.validationResult.success) {
        console.error(`❌ Validation still failing after ${retryCount} retries`);
        console.error(`❌ Final error count: ${finalResult.validationResult.errors.length}`);
        console.log(`📝 Saving best attempt to database with validation warnings...`);
      }

      // Write changes to generated directory
      await writeFilesToDir(userDir, finalResult.files);

      // Update files in the preview - only deploy if validation passed
      try {
        console.log("Updating files in preview...");
        await updatePreviewFiles(projectId, finalResult.files, accessToken, finalResult.validationResult);
        console.log("Preview files updated successfully");
      } catch (previewError) {
        // Check if this is a validation failure (400 status)
        const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
        if (errorMessage.includes('400') && errorMessage.includes('Validation failed')) {
          console.error("❌ Validation failed - preview deployment blocked");
          // Continue to save to database even if preview blocked
        } else {
          // For other errors (network, Railway issues), treat as optional
          console.warn("⚠️  Failed to update preview files (this is expected on Railway):", previewError);
        }
        console.log("📁 Files will be saved to database");
      }

      // Update project files in database
      try {
        console.log("💾 Updating project files in database...");
        
        // First, check if the project exists in the database
        const existingProject = await getProjectById(projectId);
        if (!existingProject) {
          console.log(`⚠️ Project ${projectId} not found in database, creating it...`);
          
          // Create the project in the database
          await createProject(
            user.id,
            `Project ${projectId.substring(0, 8)}`,
            `AI-generated project updated via PATCH`,
            getPreviewUrl(projectId) || undefined,
            projectId
          );
          console.log(`✅ Created project ${projectId} in database`);
        }
        
        // Read all files from the updated directory and save them
        const allFiles = await readAllFiles(userDir);
        console.log(`📁 Found ${allFiles.length} files to save to database`);
        
        // Filter out any files that might cause encoding issues
        const safeFiles = allFiles.filter(file => {
          // Check for potential encoding issues
          if (file.content.includes('\0') || file.content.includes('\x00')) {
            console.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
            return false;
          }
          return true;
        });
        
        console.log(`📁 Saving ${safeFiles.length} safe files to database`);
        await saveProjectFiles(projectId, safeFiles);
        console.log("✅ Project files updated in database successfully");
      } catch (dbError) {
        console.error("⚠️ Failed to update project files in database:", dbError);
        // Don't fail the request if database update fails
      }

      // Store patch in database for rollback capability
      let savedPatch = null;
      if (result.diffs.length > 0) {
        try {
          console.log(`📦 Storing patch with ${result.diffs.length} diffs for rollback`);

          // Create a descriptive summary of changes
          const changedFiles = result.diffs.map(d => d.filename);
          const description = `Updated ${changedFiles.length} file(s): ${changedFiles.join(', ')}`;

          // Save patch data
          savedPatch = await savePatch(projectId, {
            prompt,
            diffs: result.diffs,
            changedFiles,
            timestamp: new Date().toISOString(),
          }, description);

          console.log(`✅ Patch saved with ID: ${savedPatch.id}`);
        } catch (patchError) {
          console.error("⚠️ Failed to save patch to database:", patchError);
          // Don't fail the request if patch save fails
        }
      }

      // Get the updated preview URL (should be Vercel URL now)
      const updatedPreviewUrl = getPreviewUrl(projectId);

      return NextResponse.json({
        success: true,
        projectId,
        files: result.files,
        diffs: result.diffs,
        changed: result.files.map(f => f.filename), // Add changedFiles for frontend compatibility
        previewUrl: updatedPreviewUrl || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
        vercelUrl: updatedPreviewUrl, // Include Vercel URL
        message: "Project updated with diff-based changes",
        patchId: savedPatch?.id, // Include patch ID for tracking
        patchDescription: savedPatch?.description,
      });
    } else {
      // Handle non-streaming response with enhanced pipeline
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

      // Use the enhanced pipeline with context gathering for follow-up changes
      console.log(
        "🔄 Starting enhanced pipeline with context gathering..."
      );
      let enhancedResult = await executeEnhancedPipeline(
        prompt,
        currentFiles,
        projectId,
        accessToken,
        callLLM,
        false, // isInitialGeneration = false for PATCH requests
        userDir // projectDir
      );

      if (!enhancedResult.success) {
        throw new Error(enhancedResult.error || "Enhanced pipeline failed");
      }

      // Check validation result and retry with LLM if there are errors
      const maxRetries = 2;
      let retryCount = 0;
      
      while (enhancedResult.validationResult && !enhancedResult.validationResult.success && retryCount < maxRetries) {
        retryCount++;
        console.log(`\n⚠️  Validation failed on attempt ${retryCount}. Sending errors to LLM for fixing...`);
        console.log(`❌ Errors: ${enhancedResult.validationResult.errors.length}`);
        console.log(`⚠️  Warnings: ${enhancedResult.validationResult.warnings.length}`);
        
        // Format validation errors with file content for better context
        const errorsByFile = new Map<string, Array<{ file: string; line?: number; column?: number; message: string; severity: string }>>();
        for (const err of enhancedResult.validationResult.errors) {
          if (!errorsByFile.has(err.file)) {
            errorsByFile.set(err.file, []);
          }
          errorsByFile.get(err.file)!.push(err);
        }
        
        // Build detailed error context with full file content
        const errorDetails: string[] = [];
        for (const [filename, errors] of errorsByFile.entries()) {
          const file = enhancedResult.files.find(f => f.filename === filename);
          if (file) {
            errorDetails.push(`\n### ${filename}\n`);
            errorDetails.push(`Errors in this file:`);
            errors.forEach(err => {
              errorDetails.push(`  - Line ${err.line}:${err.column}: ${err.message}`);
            });
            errorDetails.push(`\nFull file content (errors marked with >>>):\n`);
            
            // Send the complete file with error lines marked
            const lines = file.content.split('\n');
            const errorLines = new Set(errors.map(e => (e.line ?? 1) - 1));
            lines.forEach((line, idx) => {
              const marker = errorLines.has(idx) ? '>>> ' : '    ';
              errorDetails.push(`${marker}${idx + 1}: ${line}`);
            });
          } else {
            errorDetails.push(`\n### ${filename}\n`);
            errorDetails.push(`Errors: ${errors.map(e => `Line ${e.line ?? '?'}: ${e.message}`).join(', ')}`);
          }
        }
        
        const errorContext = errorDetails.join('\n');
        
        // Create retry prompt with detailed error context
        const retryPrompt = `${prompt}\n\n⚠️  VALIDATION ERRORS DETECTED - PLEASE FIX:\n\nThe previous generation had ${enhancedResult.validationResult.errors.length} compilation errors. Here are the errors with code context:\n${errorContext}\n\nPlease analyze these errors carefully and fix them. Common issues to check:\n- Missing type imports\n- Incorrect type definitions\n- JSX syntax errors (use {{'>'}} instead of > in JSX)\n- Type mismatches\n\nRegenerate the corrected code with all errors fixed.`;
        
        console.log(`🔄 Retry ${retryCount}/${maxRetries}: Calling LLM with error context...`);
        
        // Retry with error context
        try {
          enhancedResult = await executeEnhancedPipeline(
            retryPrompt,
            currentFiles,
            projectId,
            accessToken,
            callLLM,
            false,
            userDir
          );
          
          if (!enhancedResult.success) {
            console.error(`❌ Retry ${retryCount} pipeline failed`);
            break;
          }
          
          console.log(`✅ Retry ${retryCount} generated ${enhancedResult.files.length} files`);
          
          if (enhancedResult.validationResult?.success) {
            console.log(`🎉 Validation passed on retry ${retryCount}!`);
            break;
          }
        } catch (retryError) {
          console.error(`❌ Retry ${retryCount} failed:`, retryError);
          break; // Stop retrying on errors
        }
      }
      
      // If still failing after retries, log but continue (save best attempt)
      if (enhancedResult.validationResult && !enhancedResult.validationResult.success) {
        console.error(`❌ Validation still failing after ${retryCount} retries`);
        console.error(`❌ Final error count: ${enhancedResult.validationResult.errors.length}`);
        console.log(`📝 Saving best attempt to database with validation warnings...`);
      }

      const generatedFiles = enhancedResult.files.map(f => ({
        filename: f.filename,
        content: f.content
      }));

      // Write changes to generated directory
      await writeFilesToDir(userDir, generatedFiles);

      // Update files in the preview - only deploy if validation passed
      try {
        console.log("Updating files in preview...");
        await updatePreviewFiles(projectId, generatedFiles, accessToken, enhancedResult.validationResult);
        console.log("Preview files updated successfully");
      } catch (previewError) {
        // Check if this is a validation failure (400 status)
        const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
        if (errorMessage.includes('400') && errorMessage.includes('Validation failed')) {
          console.error("❌ Validation failed - preview deployment blocked");
          // Continue to save to database even if preview blocked
        } else {
          // For other errors (network, Railway issues), treat as optional
          console.warn("⚠️  Failed to update preview files (this is expected on Railway):", previewError);
        }
        console.log("📁 Files will be saved to database");
      }

      // Update project files in database
      try {
        console.log("💾 Updating project files in database...");
        // Read all files from the updated directory and save them
        const allFiles = await readAllFiles(userDir);
        console.log(`📁 Found ${allFiles.length} files to save to database`);
        
        // Filter out any files that might cause encoding issues
        const safeFiles = allFiles.filter(file => {
          // Check for potential encoding issues
          if (file.content.includes('\0') || file.content.includes('\x00')) {
            console.log(`⚠️ Skipping file with null bytes: ${file.filename}`);
            return false;
          }
          return true;
        });
        
        console.log(`📁 Saving ${safeFiles.length} safe files to database`);
        await saveProjectFiles(projectId, safeFiles);
        console.log("✅ Project files updated in database successfully");
      } catch (dbError) {
        console.error("⚠️ Failed to update project files in database:", dbError);
        // Don't fail the request if database update fails
      }

      // Handle package.json changes (just log for now since we're not managing dependencies in preview)
      const packageJsonChanged = generatedFiles.some(
        (f) => f.filename === "package.json"
      );

      if (packageJsonChanged) {
        console.log(
          "Package.json changed - dependencies will be handled by the preview server"
        );
      }

      // Get the updated preview URL (should be Vercel URL now)
      const updatedPreviewUrl = getPreviewUrl(projectId);
      
      // Return summary
      return NextResponse.json({
        success: true,
        changed: generatedFiles.map((f) => f.filename),
        previewUrl: updatedPreviewUrl || `https://${projectId}.${CUSTOM_DOMAIN_BASE}`,
        vercelUrl: updatedPreviewUrl, // Include Vercel URL
      });
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logErrorWithContext(err as Error, 'LLM PATCH request', requestId);
    logger.error("Request failed", { 
      requestId, 
      duration, 
      error: err instanceof Error ? err.message : String(err) 
    });
    
    return NextResponse.json(
      {
        error: "Failed to apply LLM changes",
        details: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error && err.stack ? err.stack : undefined,
        requestId,
        duration
      },
      { status: 500 }
    );
  }
}
