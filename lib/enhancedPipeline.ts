import { executeMultiStagePipeline, STAGE_MODEL_CONFIG } from './llmOptimizer';
import { gatherContextWithTools } from './toolExecutionService';
import { generateDiff, applyDiffToContent, validateDiff, FileDiff, DiffHunk } from './diffUtils';

export interface EnhancedPipelineResult {
  success: boolean;
  files: { filename: string; content: string; diff?: FileDiff }[];
  contextData?: string;
  error?: string;
}

/**
 * Enhanced pipeline with context gathering and diff-based patching
 */
export async function executeEnhancedPipeline(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  projectId: string,
  accessToken: string,
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>
): Promise<EnhancedPipelineResult> {
  try {
    console.log("🚀 Starting enhanced pipeline with context gathering...");

    // Step 1: Gather context with tools if needed
    const contextResult = await gatherContextWithTools(
      userPrompt,
      currentFiles,
      projectId,
      accessToken,
      callLLM
    );

    console.log("📊 Context gathering result:");
    console.log("- Needs context:", contextResult.contextResult.needsContext);
    console.log("- Tool calls:", contextResult.contextResult.toolCalls?.length || 0);
    console.log("- Context data length:", contextResult.contextData.length);

    // Step 2: Execute the main pipeline with enhanced files
    const generatedFiles = await executeMultiStagePipeline(
      userPrompt,
      contextResult.enhancedFiles,
      callLLM,
      projectId
    );

    // Step 3: Generate diffs for each file
    const filesWithDiffs = generatedFiles.map(file => {
      const originalFile = currentFiles.find(f => f.filename === file.filename);
      
      if (!originalFile) {
        // New file - no diff needed
        return {
          filename: file.filename,
          content: file.content,
          diff: undefined
        };
      }

      // Generate diff for modified file
      try {
        const diff = generateDiff(originalFile.content, file.content, file.filename);
        
        if (validateDiff(diff)) {
          return {
            filename: file.filename,
            content: file.content,
            diff
          };
        } else {
          console.warn(`⚠️ Invalid diff generated for ${file.filename}, using full content`);
          return {
            filename: file.filename,
            content: file.content,
            diff: undefined
          };
        }
      } catch (error) {
        console.error(`❌ Failed to generate diff for ${file.filename}:`, error);
        return {
          filename: file.filename,
          content: file.content,
          diff: undefined
        };
      }
    });

    console.log("✅ Enhanced pipeline completed successfully");
    console.log(`📁 Generated ${filesWithDiffs.length} files`);
    console.log(`🔧 Context data: ${contextResult.contextData ? 'Yes' : 'No'}`);

    return {
      success: true,
      files: filesWithDiffs,
      contextData: contextResult.contextData
    };

  } catch (error) {
    console.error("❌ Enhanced pipeline failed:", error);
    return {
      success: false,
      files: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Apply diffs to files for preview updates
 */
export function applyDiffsToFiles(
  originalFiles: { filename: string; content: string }[],
  filesWithDiffs: { filename: string; content: string; diff?: FileDiff }[]
): { filename: string; content: string }[] {
  const result: { filename: string; content: string }[] = [];

  for (const fileWithDiff of filesWithDiffs) {
    if (fileWithDiff.diff) {
      // Apply diff to original content
      const originalFile = originalFiles.find(f => f.filename === fileWithDiff.filename);
      if (originalFile) {
        try {
          const hunksAsString = JSON.stringify(fileWithDiff.diff.hunks);
          const newContent = applyDiffToContent(originalFile.content, hunksAsString);
          result.push({
            filename: fileWithDiff.filename,
            content: newContent
          });
        } catch (error) {
          console.error(`Failed to apply diff to ${fileWithDiff.filename}:`, error);
          result.push({
            filename: fileWithDiff.filename,
            content: fileWithDiff.content
          });
        }
      } else {
        // New file
        result.push({
          filename: fileWithDiff.filename,
          content: fileWithDiff.content
        });
      }
    } else {
      // No diff, use full content
      result.push({
        filename: fileWithDiff.filename,
        content: fileWithDiff.content
      });
    }
  }

  return result;
}

/**
 * Get diff statistics for monitoring
 */
export function getDiffStatistics(filesWithDiffs: { filename: string; content: string; diff?: FileDiff }[]) {
  const stats = {
    totalFiles: filesWithDiffs.length,
    newFiles: 0,
    modifiedFiles: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    totalHunks: 0
  };

  for (const file of filesWithDiffs) {
    if (file.diff) {
      stats.modifiedFiles++;
      stats.totalAdditions += file.diff.hunks.reduce((acc: number, hunk: DiffHunk) => 
        acc + hunk.lines.filter((line: string) => line.startsWith('+')).length, 0);
      stats.totalDeletions += file.diff.hunks.reduce((acc: number, hunk: DiffHunk) => 
        acc + hunk.lines.filter((line: string) => line.startsWith('-')).length, 0);
      stats.totalHunks += file.diff.hunks.length;
    } else {
      stats.newFiles++;
    }
  }

  return stats;
}
