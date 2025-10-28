import fs from "fs-extra";
import path from "path";
import {
  parseContractAddressesFromDeployment,
  updateFilesWithContractAddresses
} from "./contractAddressInjector";

// Store active previews for management
const activePreviews = new Map<string, PreviewResponse>();

// Preview API configuration
const PREVIEW_API_BASE = process.env.PREVIEW_API_BASE || 'https://minidev.fun';

/**
 * Poll for deployment status when orchestrator returns "in_progress"
 */
async function pollDeploymentStatus(
  projectId: string,
  accessToken: string,
  maxAttempts: number = 30, // 30 attempts * 10 seconds = 5 minutes max
  pollInterval: number = 10000 // 10 seconds
): Promise<{ status: string; deploymentUrl?: string; error?: string; logs?: string }> {
  console.log(`🔄 Polling deployment status for ${projectId} (max ${maxAttempts} attempts, ${pollInterval}ms interval)`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`📊 Poll attempt ${attempt}/${maxAttempts}...`);
    
    try {
      const response = await fetch(`${PREVIEW_API_BASE}/deploy/status/${projectId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      
      if (!response.ok) {
        console.error(`❌ Status poll failed: ${response.status}`);
        if (response.status === 404) {
          return {
            status: 'failed',
            error: 'Deployment job not found',
          };
        }
        throw new Error(`Status poll failed: ${response.status}`);
      }
      
      const statusData = await response.json();
      console.log(`📊 Status: ${statusData.status}, Duration: ${Math.round(statusData.duration / 1000)}s`);
      
      // Check if deployment completed or failed
      if (statusData.status === 'completed') {
        console.log(`✅ Deployment completed! URL: ${statusData.deploymentUrl}`);
        return {
          status: 'completed',
          deploymentUrl: statusData.deploymentUrl,
        };
      } else if (statusData.status === 'failed') {
        console.error(`❌ Deployment failed: ${statusData.error}`);
        return {
          status: 'failed',
          error: statusData.error,
          logs: statusData.logs,
        };
      }
      
      // Still in progress, wait before next poll
      if (attempt < maxAttempts) {
        console.log(`⏳ Still in progress, waiting ${pollInterval}ms before next poll...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    } catch (error) {
      console.error(`❌ Error polling status:`, error);
      if (attempt === maxAttempts) {
        return {
          status: 'failed',
          error: `Failed to poll status: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  // Max attempts reached
  console.error(`❌ Polling timeout after ${maxAttempts} attempts`);
  return {
    status: 'failed',
    error: `Deployment status polling timeout after ${maxAttempts * pollInterval / 1000} seconds`,
  };
}

// Helper functions for path resolution
function getProjectBaseDir(projectId: string): string {
  return process.env.NODE_ENV === 'production'
    ? path.join("/tmp/generated", projectId)
    : path.join(process.cwd(), "generated", projectId);
}

function getProjectPatchesDir(projectId: string): string {
  return path.join(getProjectBaseDir(projectId), "patches");
}

export interface PreviewResponse {
  url: string;
  status: string;
  port: number;
  previewUrl?: string;
  vercelUrl?: string;
  aliasSuccess?: boolean;
  isNewDeployment?: boolean;
  hasPackageChanges?: boolean;
  contractAddresses?: { [contractName: string]: string }; // Deployed contract addresses
  deploymentError?: string; // Deployment error message if build failed
  deploymentLogs?: string; // Full deployment logs for error parsing
}

export interface PreviewFile {
  path: string;
  content: string;
}

/**
 * Deploy contracts BEFORE deploying the app
 * This allows us to inject real contract addresses into the code before first deployment
 * Returns contract addresses to inject into code
 */
export async function deployContractsFirst(
  projectId: string,
  files: { filename: string; content: string }[],
  accessToken: string
): Promise<{ [key: string]: string }> {

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔗 DEPLOYING CONTRACTS FIRST FOR PROJECT: ${projectId}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // Convert files to API format
    const filesArray = files.map(f => ({
      path: f.filename,
      content: f.content
    }));

    console.log(`📤 Sending ${filesArray.length} files to contract deployment endpoint...`);

    const response = await fetch(`${PREVIEW_API_BASE}/deploy-contracts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        files: filesArray
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Contract deployment API returned error: ${response.status}`);
      console.error(`❌ Error details: ${errorText}`);
      throw new Error(`Contract deployment failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      console.error(`❌ Contract deployment failed:`, result.error);
      throw new Error(result.error || "Contract deployment failed");
    }

    console.log(`✅ Contracts deployed successfully!`);
    console.log(`📝 Contract addresses received:`, JSON.stringify(result.contractAddresses, null, 2));
    console.log(`🌐 Network: ${result.network}`);
    console.log(`⏱️  Deployment time: ${result.deploymentTime}ms`);

    return result.contractAddresses || {};

  } catch (error) {
    console.error(`❌ Failed to deploy contracts for ${projectId}:`, error);
    console.error(`❌ Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

// Create a preview using the external API
export async function createPreview(
  projectId: string,
  files: { filename: string; content: string }[],
  accessToken: string,
  isWeb3?: boolean,
  skipContracts?: boolean // NEW: Allow caller to specify if contracts already deployed
): Promise<PreviewResponse> {
  console.log(`🚀 Creating preview for project: ${projectId}`);
  console.log(`📁 Files count: ${files.length}`);
  console.log(`🔑 Access token: ${accessToken ? 'Present' : 'Missing'}`);
  console.log(`🌐 Preview API Base: ${PREVIEW_API_BASE}`);
  console.log(`🔧 isWeb3: ${isWeb3 !== undefined ? isWeb3 : 'not specified'}`);
  console.log(`🔧 skipContracts: ${skipContracts !== undefined ? skipContracts : 'not specified'}`);

  try {
    // Convert files array to object format expected by the API
    const filesObject: { [key: string]: string } = {};
    files.forEach((file) => {
      filesObject[file.filename] = file.content;
    });

    console.log(`📦 Converted ${Object.keys(filesObject).length} files to object format`);

    // Skip contracts if:
    // 1. Explicitly told to skip (contracts already deployed)
    // 2. Non-Web3 app
    const shouldSkipContracts = skipContracts ?? (isWeb3 === false);

    const requestBody = {
      hash: projectId,
      files: filesObject,
      deployToExternal: "vercel",
      isWeb3: isWeb3 !== undefined ? isWeb3 : true, // Default to true for backward compatibility
      skipContracts: shouldSkipContracts, // Skip if already deployed OR non-Web3
    };

    console.log(`📤 Sending request to: ${PREVIEW_API_BASE}/deploy`);
    console.log(`📤 Request body keys: ${Object.keys(requestBody)}`);

    // Make API request to create preview with extended timeout for Vercel deployment
    // Set to 7 minutes to allow first deployment to complete (typical: 4-5 min)
    // Still short enough to retry before Vercel function's 10-minute limit
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      console.log(`⏱️ Starting deployment request (timeout: 7 min)...`);

      // Use native http module for better timeout control
      const http = await import('http');
      const https = await import('https');
      const url = new URL(`${PREVIEW_API_BASE}/deploy`);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 420000, // 7 minutes
      };

      const requestData = JSON.stringify(requestBody);

      const response: { success: boolean; error?: string; previewUrl?: string; vercelUrl?: string; [key: string]: unknown } = await new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
          console.log(`📥 Response received - Status: ${res.statusCode}, Headers:`, res.headers);
          let data = '';
          let dataChunks = 0;
          res.on('data', (chunk) => {
            data += chunk;
            dataChunks++;
            if (dataChunks % 10 === 0) {
              console.log(`📥 Received ${dataChunks} chunks, ${data.length} bytes so far...`);
            }
          });
          res.on('end', () => {
            console.log(`📥 Response complete - Total size: ${data.length} bytes from ${dataChunks} chunks`);
            clearTimeout(timeoutId);
            const success = res.statusCode! >= 200 && res.statusCode! < 300;
            try {
              const responseData = JSON.parse(data);
              resolve({
                success,
                ...responseData,
                status: res.statusCode,
                statusText: res.statusMessage,
              });
            } catch (parseError) {
              resolve({
                success,
                error: `Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                status: res.statusCode,
                statusText: res.statusMessage,
              });
            }
          });
        });

        req.on('error', (error) => {
          clearTimeout(timeoutId);
          console.error(`❌ Request error:`, error);
          reject(error);
        });

        req.on('timeout', () => {
          clearTimeout(timeoutId);
          req.destroy();
          console.error(`❌ Request timeout after 7 minutes`);
          reject(new Error('Request timeout after 7 minutes'));
        });

        // Set up our own timeout to destroy the request
        timeoutId = setTimeout(() => {
          console.log(`⏱️ Manual timeout after 7 minutes, destroying request...`);
          req.destroy();
          reject(new Error('Request timeout after 7 minutes'));
        }, 420000); // 7 minute timeout

        req.write(requestData);
        req.end();
      });

      console.log(`✅ Received response from deploy endpoint`);

      console.log(`📥 Response status: ${response.status}`);
      console.log(`📥 Response statusText: ${response.statusText}`);

      if (!response.success) {
        console.error(`❌ Preview API returned error: ${response.status}`);
        console.error(`❌ Error details: ${response.error || 'Unknown error'}`);
        console.log(`📋 Response has logs field: ${!!response.logs}`);
        console.log(`📋 Response has output field: ${!!response.output}`);
        console.log(`📋 Response has details field: ${!!response.details}`);
        
        // Return deployment error info instead of throwing
        // This allows the caller to parse errors and retry with fixes
        const deploymentLogs = (response.logs as string) || (response.output as string) || (response.details as string) || '';
        console.log(`📋 Deployment logs length: ${deploymentLogs.length} characters`);
        
        const errorResponse: PreviewResponse = {
          url: `${PREVIEW_API_BASE}/p/${projectId}`,
          status: 'deployment_failed',
          port: 3000,
          deploymentError: response.error as string || 'Unknown deployment error',
          deploymentLogs,
        };
        
        return errorResponse;
      }

      const apiResponse = response;

      console.log("📦 API Response:", JSON.stringify(apiResponse, null, 2));
      
      // Check if deployment is still in progress (hybrid approach)
      if (apiResponse.status === 'in_progress') {
        console.log(`⏳ Deployment in progress, starting polling...`);
        console.log(`📊 Message: ${apiResponse.message}`);
        console.log(`⏱️  Estimated time: ${apiResponse.estimatedTime}`);
        
        // Poll for deployment status
        const pollResult = await pollDeploymentStatus(projectId, accessToken);
        
        if (pollResult.status === 'completed' && pollResult.deploymentUrl) {
          console.log(`✅ Polled deployment completed successfully`);
          // Update apiResponse with completed deployment data
          apiResponse.previewUrl = pollResult.deploymentUrl;
          apiResponse.vercelUrl = pollResult.deploymentUrl;
          apiResponse.status = 'completed';
          apiResponse.success = true;
        } else if (pollResult.status === 'failed') {
          console.error(`❌ Polled deployment failed: ${pollResult.error}`);
          // Return deployment failure
          return {
            url: `${PREVIEW_API_BASE}/p/${projectId}`,
            status: 'deployment_failed',
            port: 3000,
            deploymentError: pollResult.error || 'Deployment failed during polling',
            deploymentLogs: pollResult.logs || '',
          };
        }
      }

      // Parse contract addresses from deployment response
      const contractAddresses = parseContractAddressesFromDeployment(apiResponse);

      // LEGACY FALLBACK: If contract addresses were deployed by the orchestrator (old flow),
      // inject them into the files and re-save
      // NOTE: With the new flow, contracts are deployed FIRST via /deploy-contracts,
      // so this code should rarely execute. It's kept for backward compatibility.
      if (contractAddresses && Object.keys(contractAddresses).length > 0) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`📝 LEGACY: CONTRACT ADDRESSES DETECTED FROM ORCHESTRATOR`);
        console.log(`📝 (This shouldn't happen with new deploy-contracts-first flow)`);
        console.log(`${"=".repeat(60)}`);
        console.log(`Deployed contracts:`, contractAddresses);

        // Update files with contract addresses
        const updatedFiles = updateFilesWithContractAddresses(files, contractAddresses);

        // Save updated files to generated directory
        try {
          await saveFilesToGenerated(projectId, updatedFiles);
          console.log(`✅ Updated files saved with contract addresses`);

          // Auto-redeploy to Vercel with real contract addresses
          console.log(`\n${"=".repeat(60)}`);
          console.log(`🔄 REDEPLOYING TO VERCEL WITH REAL CONTRACT ADDRESSES`);
          console.log(`${"=".repeat(60)}`);

          try {
            await updatePreviewFiles(projectId, updatedFiles, accessToken);
            console.log(`✅ Vercel deployment updated with real contract addresses`);
          } catch (redeployError) {
            console.error(`⚠️  Failed to redeploy with contract addresses:`, redeployError);
            console.log(`📁 Files have been saved locally but Vercel deployment may have old addresses`);
            // Don't fail the entire deployment - local files are updated
          }
        } catch (saveError) {
          console.error(`⚠️  Failed to save updated files:`, saveError);
        }
      }

      // Map the API response to our PreviewResponse format
      const previewData: PreviewResponse = {
        url:
          apiResponse.previewUrl ||
          apiResponse.vercelUrl ||
          `${PREVIEW_API_BASE}/p/${projectId}`,
        status: (apiResponse.status as string) || (apiResponse.isNewDeployment ? "deployed" : "updated"),
        port: (apiResponse.port as number) || 3000, // Use port from response or default to 3000
        previewUrl: apiResponse.previewUrl as string,
        vercelUrl: apiResponse.vercelUrl as string,
        aliasSuccess: apiResponse.aliasSuccess as boolean,
        isNewDeployment: apiResponse.isNewDeployment as boolean,
        hasPackageChanges: apiResponse.hasPackageChanges as boolean,
        contractAddresses: contractAddresses || undefined,
        deploymentError: apiResponse.error as string || undefined,
        deploymentLogs: apiResponse.logs as string || apiResponse.output as string || undefined,
      };

      // Store the preview info
      activePreviews.set(projectId, previewData);

      console.log(`✅ Preview created successfully!`);
      console.log(`   URL: ${previewData.url}`);
      console.log(`   Preview URL: ${previewData.previewUrl}`);
      console.log(`   Vercel URL: ${previewData.vercelUrl}`);
      console.log(`   Status: ${previewData.status}`);
      console.log(`   Port: ${previewData.port}`);

      return previewData;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    console.error(`❌ Failed to create preview for ${projectId}:`, error);
    console.error(`❌ Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

// Update files in an existing preview
export async function updatePreviewFiles(
  projectId: string,
  changedFiles: { filename: string; content: string }[],
  accessToken: string,
  validationResult?: { success: boolean; errors: Array<{ file: string; line?: number; column?: number; message: string; severity: string }>; warnings: Array<{ file: string; line?: number; column?: number; message: string; severity: string }> }
): Promise<void> {
  console.log(
    `🔄 Updating ${changedFiles.length} files in preview for project: ${projectId}`
  );

  try {
    // Convert files array to the format expected by the /previews endpoint
    const filesArray = changedFiles.map(file => ({
      path: file.filename,
      content: file.content
    }));

    // Make API request to update preview using the /previews endpoint
    // This will update the same deployment and handle Vercel updates automatically
    const response = await fetch(`${PREVIEW_API_BASE}/previews`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: projectId,
        files: filesArray,
        wait: false, // Don't wait for readiness on updates
        validationResult, // Pass validation result to block deployment if it failed
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update preview: ${response.status} ${errorText}`
      );
    }

    // Handle the response from the update API
    const updateResponse = await response.json();
    console.log(`✅ Preview files updated successfully for ${projectId}`);
    console.log(`📊 Update Response:`, updateResponse);
    
    // Update the stored preview info with the Vercel URL if it was updated
    if (updateResponse.vercelUrl) {
      const existingPreview = activePreviews.get(projectId);
      if (existingPreview) {
        existingPreview.vercelUrl = updateResponse.vercelUrl;
        existingPreview.url = updateResponse.vercelUrl;
        activePreviews.set(projectId, existingPreview);
        console.log(`🌐 Updated Vercel URL: ${updateResponse.vercelUrl}`);
      }
    }
  } catch (error) {
    console.error(`❌ Failed to update preview files for ${projectId}:`, error);
    // Don't throw - just log the error. The files are already saved to database.
    // The preview will be out of sync but the user can still access the project.
    console.warn(`⚠️  Preview update failed for ${projectId}, but files are saved to database`);
  }
}

// Get the full preview URL
export function getPreviewUrl(projectId: string): string | null {
  const preview = activePreviews.get(projectId);
  if (!preview) {
    return null;
  }

  // Use the previewUrl from the API response if available, otherwise fallback to the url field
  return preview.previewUrl || preview.url;
}

// Save files to local generated directory
export async function saveFilesToGenerated(
  projectId: string,
  files: { filename: string; content: string }[]
): Promise<void> {
  const generatedDir = getProjectBaseDir(projectId);

  console.log(
    `💾 Saving ${files.length} files to generated directory: ${generatedDir}`
  );

  try {
    // Ensure the directory exists
    await fs.ensureDir(generatedDir);

    // Write each file
    for (const file of files) {
      const filePath = path.join(generatedDir, file.filename);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, file.content, "utf8");
      console.log(`✅ Saved: ${file.filename}`);
    }

    console.log(`✅ All files saved to generated directory`);
  } catch (error) {
    console.error(`❌ Failed to save files to generated directory:`, error);
    throw error;
  }
}

// List files from generated directory
export async function listGeneratedFiles(projectId: string): Promise<string[]> {
  const generatedDir = getProjectBaseDir(projectId);

  try {
    if (!(await fs.pathExists(generatedDir))) {
      return [];
    }

    const files: string[] = [];

    async function scanDirectory(dir: string, basePath: string = "") {
      const items = await fs.readdir(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.join(basePath, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules, .next, etc.
          if (
            item === "node_modules" ||
            item === ".next" ||
            item === "dist" ||
            item === "build" ||
            item === ".git"
          ) {
            continue;
          }
          await scanDirectory(fullPath, relativePath);
        } else {
          // Only include relevant file types
          const ext = path.extname(item);
          if (
            [
              ".tsx",
              ".ts",
              ".jsx",
              ".js",
              ".json",
              ".css",
              ".html",
              ".md",
            ].includes(ext)
          ) {
            files.push(relativePath);
          }
        }
      }
    }

    await scanDirectory(generatedDir);
    return files.sort();
  } catch (error) {
    console.error(`❌ Failed to list generated files for ${projectId}:`, error);
    return [];
  }
}

// Get file content from generated directory
export async function getGeneratedFile(
  projectId: string,
  filePath: string
): Promise<string | null> {
  const generatedDir = getProjectBaseDir(projectId);
  const fullPath = path.join(generatedDir, filePath);

  try {
    if (await fs.pathExists(fullPath)) {
      return await fs.readFile(fullPath, "utf8");
    }
    return null;
  } catch (error) {
    console.error(`❌ Failed to read generated file ${filePath}:`, error);
    return null;
  }
}

// Update a file in generated directory
export async function updateGeneratedFile(
  projectId: string,
  filename: string,
  content: string
): Promise<void> {
  const generatedDir = getProjectBaseDir(projectId);
  const filePath = path.join(generatedDir, filename);

  try {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, "utf8");
    console.log(`✅ Updated generated file: ${filename}`);
  } catch (error) {
    console.error(`❌ Failed to update generated file ${filename}:`, error);
    throw error;
  }
}

// Delete a file from generated directory
export async function deleteGeneratedFile(
  projectId: string,
  filename: string
): Promise<void> {
  const generatedDir = getProjectBaseDir(projectId);
  const filePath = path.join(generatedDir, filename);

  try {
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      console.log(`✅ Deleted generated file: ${filename}`);
    }
  } catch (error) {
    console.error(`❌ Failed to delete generated file ${filename}:`, error);
    throw error;
  }
}

// Diff-based preview update for surgical changes
export async function updatePreviewWithDiffs(
  projectId: string,
  files: { filename: string; content: string }[],
  accessToken: string,
  diffs?: Array<{ filename: string; hunks: unknown[]; unifiedDiff: string }>
): Promise<PreviewResponse> {
  console.log(`🔄 Updating preview with diffs for project ${projectId}`);
  console.log(`📁 Files to update: ${files.length}`);
  console.log(`🔧 Diffs to apply: ${diffs?.length || 0}`);

  try {
    // Use the existing updatePreviewFiles function
    await updatePreviewFiles(projectId, files, accessToken);
    
    // Since updatePreviewFiles returns void, we need to create a PreviewResponse
    const previewResponse: PreviewResponse = {
      url: `${PREVIEW_API_BASE}/preview/${projectId}`,
      status: 'updated',
      port: 3000 // Default port
    };
    console.log(`✅ Preview updated with diffs: ${previewResponse.url}`);
    return previewResponse;
  } catch (error) {
    console.error(`❌ Failed to update preview with diffs:`, error);
    throw error;
  }
}

// Store diffs for rollback capability
export async function storeDiffs(
  projectId: string,
  diffs: Array<{ filename: string; hunks: unknown[]; unifiedDiff: string }>
): Promise<void> {
  const patchesDir = getProjectPatchesDir(projectId);
  
  try {
    await fs.ensureDir(patchesDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const diffFile = path.join(patchesDir, `diff-${timestamp}.json`);
    
    await fs.writeFile(diffFile, JSON.stringify(diffs, null, 2));
    console.log(`📦 Stored ${diffs.length} diffs for project ${projectId}`);
  } catch (error) {
    console.error(`❌ Failed to store diffs:`, error);
    throw error;
  }
}

// Get stored diffs for rollback
export async function getStoredDiffs(projectId: string): Promise<Array<{ filename: string; hunks: unknown[]; unifiedDiff: string }>> {
  const patchesDir = getProjectPatchesDir(projectId);
  
  try {
    if (!(await fs.pathExists(patchesDir))) {
      return [];
    }
    
    const files = await fs.readdir(patchesDir);
    const diffFiles = files.filter(f => f.startsWith('diff-') && f.endsWith('.json'));
    
    if (diffFiles.length === 0) {
      return [];
    }
    
    // Get the most recent diff file
    const latestDiffFile = diffFiles.sort().pop();
    const diffPath = path.join(patchesDir, latestDiffFile!);
    
    const diffContent = await fs.readFile(diffPath, 'utf8');
    return JSON.parse(diffContent);
  } catch (error) {
    console.error(`❌ Failed to get stored diffs:`, error);
    return [];
  }
}
