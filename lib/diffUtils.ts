import { createPatch, parsePatch } from 'diff';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  filename: string;
  hunks: DiffHunk[];
  unifiedDiff: string;
}

/**
 * Generate a unified diff between original and new content
 */
export function generateDiff(
  originalContent: string,
  newContent: string,
  filename: string
): FileDiff {
  try {
    const unifiedDiff = createPatch(filename, originalContent, newContent);
    const parsedPatches = parsePatch(unifiedDiff);
    const hunks = parsedPatches?.[0]?.hunks || [];
    
    return {
      filename,
      hunks,
      unifiedDiff
    };
  } catch (error) {
    console.error('Error generating diff:', error);
    throw new Error(`Failed to generate diff for ${filename}: ${error}`);
  }
}

/**
 * Apply unified diff string to original content
 */
export function applyDiffToContent(
  originalContent: string,
  unifiedDiff: string
): string {
  try {
    // Parse the unified diff string into hunks
    const hunks = parseUnifiedDiff(unifiedDiff);
    return applyDiffHunks(originalContent, hunks);
  } catch (error) {
    console.error('Error applying unified diff:', error);
    throw new Error(`Failed to apply unified diff: ${error}`);
  }
}

/**
 * Parse unified diff string into hunks with robust error handling
 */
export function parseUnifiedDiff(unifiedDiff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = unifiedDiff.split('\n');

  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Save previous hunk if exists
      if (currentHunk) {
        // Auto-correct oldLines/newLines if they're 0 but there are actual lines
        currentHunk = validateAndCorrectHunk(currentHunk);
        hunks.push(currentHunk);
      }

      // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      // Support various formats including malformed ones
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        const oldLines = parseInt(match[2]) || 0;
        const newLines = parseInt(match[4]) || 0;

        // If oldLines or newLines is 0, it's likely a mistake - we'll correct it later
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: oldLines,
          newStart: parseInt(match[3]),
          newLines: newLines,
          lines: []
        };
      } else {
        console.warn(`⚠️ Malformed hunk header: ${line}`);
      }
    } else if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  // Add the last hunk with validation
  if (currentHunk) {
    currentHunk = validateAndCorrectHunk(currentHunk);
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Validate and auto-correct common mistakes in diff hunks
 */
function validateAndCorrectHunk(hunk: DiffHunk): DiffHunk {
  // Count actual add/remove/context lines
  let contextLines = 0;
  let removeLines = 0;
  let addLines = 0;

  for (const line of hunk.lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addLines++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removeLines++;
    } else if (line.startsWith(' ') || (!line.startsWith('+') && !line.startsWith('-'))) {
      contextLines++;
    }
  }

  // Calculate expected line counts
  const expectedOldLines = contextLines + removeLines;
  const expectedNewLines = contextLines + addLines;

  // Auto-correct if counts don't match
  if (hunk.oldLines === 0 || hunk.oldLines !== expectedOldLines) {
    console.log(`🔧 Auto-correcting oldLines: ${hunk.oldLines} → ${expectedOldLines} for hunk at line ${hunk.oldStart}`);
    hunk.oldLines = expectedOldLines;
  }

  if (hunk.newLines === 0 || hunk.newLines !== expectedNewLines) {
    console.log(`🔧 Auto-correcting newLines: ${hunk.newLines} → ${expectedNewLines} for hunk at line ${hunk.newStart}`);
    hunk.newLines = expectedNewLines;
  }

  return hunk;
}

/**
 * Pre-validate diff hunks against actual file content to catch potential context mismatches
 */
export function validateDiffHunksAgainstFile(
  filePath: string,
  fileContent: string,
  diffHunks: DiffHunk[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lines = fileContent.split('\n');

  for (const hunk of diffHunks) {
    // Check if hunk start position is valid
    if (hunk.oldStart < 1 || hunk.oldStart > lines.length) {
      errors.push(`Hunk starts at invalid line ${hunk.oldStart} (file has ${lines.length} lines)`);
      continue;
    }

    // Extract context lines from the hunk to validate against file content
    const contextLines = hunk.lines
      .filter(line => line.startsWith(' ') || (!line.startsWith('+') && !line.startsWith('-')))
      .map(line => line.startsWith(' ') ? line.substring(1) : line);

    if (contextLines.length === 0) {
      errors.push(`Hunk at line ${hunk.oldStart} has no context lines for validation`);
      continue;
    }

    // Find the first context line in the actual file content
    const firstContextLine = contextLines[0];
    let actualStartIndex = -1;

    // Search for the context line near the expected position
    const searchStart = Math.max(0, hunk.oldStart - 10);
    const searchEnd = Math.min(lines.length, hunk.oldStart + 10);

    for (let i = searchStart; i < searchEnd; i++) {
      if (lines[i] && lines[i].trim() === firstContextLine.trim()) {
        actualStartIndex = i + 1; // Convert to 1-based indexing
        break;
      }
    }

    if (actualStartIndex === -1) {
      errors.push(`Context line "${firstContextLine}" not found near line ${hunk.oldStart} in ${filePath}`);
    } else if (Math.abs(actualStartIndex - hunk.oldStart) > 5) {
      errors.push(`Context line "${firstContextLine}" found at line ${actualStartIndex}, but hunk expects line ${hunk.oldStart} (difference: ${Math.abs(actualStartIndex - hunk.oldStart)})`);
    }

    // Validate that we have enough lines in the file for this hunk
    const hunkEndLine = hunk.oldStart + hunk.oldLines - 1;
    if (hunkEndLine > lines.length) {
      errors.push(`Hunk extends to line ${hunkEndLine} but file only has ${lines.length} lines`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Find the best contextual match for a line when exact match fails
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function findBestContextualMatch(
  lines: string[],
  targetLine: string,
  expectedIndex: number,
  contextLines: string[]
): { index: number; reason: string } {
  const targetTrimmed = targetLine.trim();
  
  // Strategy 1: Look for exact content match within reasonable distance
  const searchRadius = Math.min(50, lines.length / 4); // Search within 50 lines or 25% of file
  const searchStart = Math.max(0, expectedIndex - searchRadius);
  const searchEnd = Math.min(lines.length, expectedIndex + searchRadius);
  
  for (let i = searchStart; i < searchEnd; i++) {
    if (lines[i] && lines[i].trim() === targetTrimmed) {
      const distance = Math.abs(i - expectedIndex);
      return { index: i, reason: `exact content match (distance: ${distance})` };
    }
  }
  
  // Strategy 2: Look for partial content match (key-based) within reasonable distance
  const keyToReplace = targetLine.split(':')[0].trim() || targetLine.split('=')[0].trim() || targetLine.split(' ')[0].trim();
  
  let bestKeyMatch = { index: -1, distance: Infinity, reason: '' };
  
  for (let i = searchStart; i < searchEnd; i++) {
    if (lines[i] && lines[i].includes(keyToReplace)) {
      const distance = Math.abs(i - expectedIndex);
      if (distance < bestKeyMatch.distance) {
        bestKeyMatch = { index: i, distance, reason: `key match "${keyToReplace}" (distance: ${distance})` };
      }
    }
  }
  
  if (bestKeyMatch.index !== -1) {
    return bestKeyMatch;
  }
  
  // Strategy 3: Look for context-based match using surrounding lines
  // Extract context from the diff hunk
  const contextBefore = contextLines.filter(line => !line.startsWith('+') && !line.startsWith('-')).slice(0, 2);
  const contextAfter = contextLines.filter(line => !line.startsWith('+') && !line.startsWith('-')).slice(-2);
  
  let bestContextMatch = { index: -1, score: 0, reason: '' };
  
  for (let i = 0; i < lines.length - contextBefore.length - contextAfter.length; i++) {
    let score = 0;
    
    // Check context before
    for (let j = 0; j < contextBefore.length; j++) {
      if (lines[i + j] && lines[i + j].trim() === contextBefore[j].trim()) {
        score += 1;
      }
    }
    
    // Check context after
    for (let j = 0; j < contextAfter.length; j++) {
      if (lines[i + contextBefore.length + 1 + j] && 
          lines[i + contextBefore.length + 1 + j].trim() === contextAfter[j].trim()) {
        score += 1;
      }
    }
    
    if (score > bestContextMatch.score) {
      bestContextMatch = { 
        index: i + contextBefore.length, 
        score, 
        reason: `context match (score: ${score}/${contextBefore.length + contextAfter.length})` 
      };
    }
  }
  
  if (bestContextMatch.score > 0) {
    return bestContextMatch;
  }
  
  return { index: -1, reason: 'no suitable match found' };
}

/**
 * Apply diff hunks to original content
 */
export function applyDiffHunks(
  originalContent: string,
  diffHunks: DiffHunk[]
): string {
  try {
    const lines = originalContent.split('\n');
    const result: string[] = [...lines];

    // Process hunks in reverse order to maintain line numbers
    const sortedHunks = [...diffHunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      let startLineIndex = hunk.oldStart - 1; // Convert to 0-based index

      // Parse hunk to extract context, removes, and adds
      const parsedLines: Array<{ type: 'remove' | 'add' | 'context'; line: string }> = [];
      for (const diffLine of hunk.lines) {
        if (diffLine.startsWith('-')) {
          parsedLines.push({ type: 'remove', line: diffLine.substring(1) });
        } else if (diffLine.startsWith('+')) {
          parsedLines.push({ type: 'add', line: diffLine.substring(1) });
        } else {
          const lineContent = diffLine.startsWith(' ') ? diffLine.substring(1) : diffLine;
          parsedLines.push({ type: 'context', line: lineContent });
        }
      }

      // AGGRESSIVE FUZZY SEARCH: Find the correct position by matching ALL context lines in the entire file
      // This handles cases where LLM generates wrong line numbers despite having numbered context
      const contextLines = parsedLines.filter(p => p.type === 'context');
      
      if (contextLines.length >= 2) {
        // Use as many context lines as possible for a unique match
        const searchContextLines = contextLines.slice(0, Math.min(5, contextLines.length));
        let bestMatch = -1;
        let bestMatchScore = 0;

        // Search ENTIRE file, not just a narrow window
        for (let i = 0; i <= result.length - searchContextLines.length; i++) {
          let matchScore = 0;
          let consecutiveMatches = true;
          
          // Try to match the sequence of context lines starting from position i
          for (let j = 0; j < searchContextLines.length; j++) {
            const fileLineIndex = i + j;
            const fileLine = result[fileLineIndex];
            const contextLine = searchContextLines[j].line;
            
            if (fileLine !== undefined && fileLine.trim() === contextLine.trim()) {
              matchScore++;
            } else {
              consecutiveMatches = false;
              break;
            }
          }
          
          // If we matched all context lines consecutively, this is the position
          if (consecutiveMatches && matchScore === searchContextLines.length) {
            bestMatch = i;
            bestMatchScore = matchScore;
            // Found perfect match, use it
            console.log(`🎯 Found exact match at line ${i + 1} (diff said ${hunk.oldStart}, offset: ${Math.abs(i + 1 - hunk.oldStart)})`);
            break;
          } else if (matchScore > bestMatchScore) {
            // Keep track of best partial match
            bestMatch = i;
            bestMatchScore = matchScore;
          }
        }
        
        // Use the best match found (require at least 50% of context lines to match)
        if (bestMatchScore >= Math.ceil(searchContextLines.length / 2)) {
          startLineIndex = bestMatch;
          if (bestMatch + 1 !== hunk.oldStart) {
            console.log(`📍 Corrected line number: ${hunk.oldStart} → ${bestMatch + 1} (matched ${bestMatchScore}/${searchContextLines.length} context lines)`);
          }
        } else {
          console.warn(`⚠️ Could not find good match for hunk at line ${hunk.oldStart} (best: ${bestMatchScore}/${searchContextLines.length})`);
        }
      }

      // Build operations with corrected indices
      // CRITICAL: Use the corrected startLineIndex from fuzzy search, not the line from diff header
      const operations: Array<{ type: 'remove' | 'add' | 'context'; line: string; index: number }> = [];
      let currentLineIndex = startLineIndex; // This is already corrected by fuzzy search above

      console.log(`Building operations starting at corrected line ${startLineIndex + 1} (diff header said ${hunk.oldStart})`);

      for (const parsed of parsedLines) {
        if (parsed.type === 'remove') {
          operations.push({ type: 'remove', line: parsed.line, index: currentLineIndex });
          currentLineIndex++;
        } else if (parsed.type === 'add') {
          operations.push({ type: 'add', line: parsed.line, index: currentLineIndex });
        } else {
          operations.push({ type: 'context', line: parsed.line, index: currentLineIndex });
          currentLineIndex++;
        }
      }

      // Verify context lines match before applying changes
      // Use lenient matching: allow some mismatches, especially for whitespace
      const hasContextLines = operations.some(op => op.type === 'context');
      let contextMatchCount = 0;
      let contextTotalCount = 0;
      const mismatchedLines: Array<{index: number; expected: string; got: string}> = [];

      if (hasContextLines) {
        for (const op of operations) {
          if (op.type === 'context') {
            contextTotalCount++;
            const fileLine = result[op.index];
            const expectedLine = op.line;
            
            if (fileLine !== undefined) {
              const fileLineTrimmed = fileLine.trim();
              const expectedLineTrimmed = expectedLine.trim();
              
              // Count as match if:
              // 1. Both are empty/whitespace, OR
              // 2. Trimmed content matches
              if ((fileLineTrimmed === '' && expectedLineTrimmed === '') || 
                  fileLineTrimmed === expectedLineTrimmed) {
                contextMatchCount++;
              } else {
                mismatchedLines.push({
                  index: op.index + 1,
                  expected: expectedLineTrimmed,
                  got: fileLineTrimmed
                });
              }
            }
          }
        }

        // Use tolerance: require at least 70% of context lines to match
        const matchRatio = contextTotalCount > 0 ? contextMatchCount / contextTotalCount : 0;
        const hasEnoughMatches = matchRatio >= 0.7;

        if (!hasEnoughMatches) {
          console.warn(`Skipping hunk at line ${hunk.oldStart}: insufficient context match (${contextMatchCount}/${contextTotalCount} = ${(matchRatio * 100).toFixed(0)}%)`);
          if (mismatchedLines.length > 0) {
            console.warn('Mismatched lines:');
            mismatchedLines.slice(0, 3).forEach(m => {
              console.warn(`  Line ${m.index}: expected "${m.expected}", got "${m.got}"`);
            });
          }
          continue;
        } else if (mismatchedLines.length > 0) {
          console.log(`Applying hunk at line ${hunk.oldStart} with ${contextMatchCount}/${contextTotalCount} context matches (${(matchRatio * 100).toFixed(0)}%)`);
        }
      }

      // Apply operations: process removes and adds together to maintain proper ordering
      // Group consecutive operations by their index
      const grouped: Array<{ index: number; removes: string[]; adds: string[] }> = [];
      let currentGroup: { index: number; removes: string[]; adds: string[] } | null = null;

      for (const op of operations) {
        if (op.type === 'remove' || op.type === 'add') {
          if (!currentGroup || currentGroup.index !== op.index) {
            if (currentGroup) {
              grouped.push(currentGroup);
            }
            currentGroup = { index: op.index, removes: [], adds: [] };
          }

          if (op.type === 'remove') {
            currentGroup.removes.push(op.line);
          } else {
            currentGroup.adds.push(op.line);
          }
        }
      }

      if (currentGroup) {
        grouped.push(currentGroup);
      }

      // Apply grouped operations in reverse order to maintain indices
      for (let i = grouped.length - 1; i >= 0; i--) {
        const group = grouped[i];

        // Remove lines
        if (group.removes.length > 0) {
          result.splice(group.index, group.removes.length);
        }

        // Add lines at the same position
        if (group.adds.length > 0) {
          result.splice(group.index, 0, ...group.adds);
        }
      }
    }

    return result.join('\n');
  } catch (error) {
    console.error('Error applying diff:', error);
    throw new Error(`Failed to apply diff: ${error}`);
  }
}

/**
 * Validate diff structure and syntax
 */
export function validateDiff(diff: FileDiff): boolean {
  try {
    // Check if hunks array exists and is valid
    if (!Array.isArray(diff.hunks)) {
      return false;
    }

    // Validate each hunk structure
    const structureValid = diff.hunks.every(hunk => 
      typeof hunk.oldStart === 'number' && hunk.oldStart > 0 &&
      typeof hunk.newStart === 'number' && hunk.newStart > 0 &&
      typeof hunk.oldLines === 'number' && hunk.oldLines >= 0 &&
      typeof hunk.newLines === 'number' && hunk.newLines >= 0 &&
      Array.isArray(hunk.lines)
    );

    if (!structureValid) {
      return false;
    }

    // Additional syntax validation: Check for code inserted inside array/object literals
    for (const hunk of diff.hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        const nextLine = i + 1 < hunk.lines.length ? hunk.lines[i + 1] : null;
        
        // Check if this is an array/object literal opening followed by code insertion
        if (line.match(/^[+ ]\s*const\s+\w+\s*=.*\[\s*$/) || 
            line.match(/^[+ ]\s*const\s+\w+\s*=.*\{\s*$/)) {
          // Next line should be array/object content, not code statements
          if (nextLine && nextLine.match(/^\+\s*(console\.|if\s*\(|for\s*\(|while\s*\(|return\s)/)) {
            console.error('❌ Diff validation failed: Code statement inserted inside array/object literal');
            console.error(`   Line: ${line}`);
            console.error(`   Next: ${nextLine}`);
            return false;
          }
        }

        // Check for orphaned statements that look like they're inside literals
        if (line.match(/^\+\s*(console\.|if\s*\(|for\s*\(|while\s*\(|return\s)/) && nextLine) {
          // If next line is an array/object element, the statement is likely misplaced
          if (nextLine.match(/^[+ ]\s*\[.*\]|^[+ ]\s*\{.*\}|^[+ ]\s*\d+|^[+ ]\s*['"`]/)) {
            console.warn('⚠️  Possible misplaced code statement near array/object elements');
            console.warn(`   Line: ${line}`);
            console.warn(`   Next: ${nextLine}`);
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error validating diff:', error);
    return false;
  }
}

/**
 * Create a minimal diff with context lines
 */
export function createMinimalDiff(
  originalContent: string,
  newContent: string,
  filename: string,
  contextLines: number = 3
): FileDiff {
  const lines = originalContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Find the differences
  const changes: Array<{
    type: 'add' | 'remove' | 'context';
    line: string;
    lineNumber: number;
  }> = [];

  let i = 0, j = 0;
  while (i < lines.length || j < newLines.length) {
    if (i >= lines.length) {
      // Addition
      changes.push({
        type: 'add',
        line: newLines[j],
        lineNumber: j + 1
      });
      j++;
    } else if (j >= newLines.length) {
      // Removal
      changes.push({
        type: 'remove',
        line: lines[i],
        lineNumber: i + 1
      });
      i++;
    } else if (lines[i] === newLines[j]) {
      // Context
      changes.push({
        type: 'context',
        line: lines[i],
        lineNumber: i + 1
      });
      i++;
      j++;
    } else {
      // Find the best match
      let found = false;
      for (let k = 1; k <= 10 && j + k < newLines.length; k++) {
        if (lines[i] === newLines[j + k]) {
          // Additions
          for (let l = 0; l < k; l++) {
            changes.push({
              type: 'add',
              line: newLines[j + l],
              lineNumber: j + l + 1
            });
          }
          j += k;
          found = true;
          break;
        }
      }
      
      if (!found) {
        // Removal
        changes.push({
          type: 'remove',
          line: lines[i],
          lineNumber: i + 1
        });
        i++;
      }
    }
  }

  // Group changes into hunks
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let contextCount = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    
    if (change.type === 'context') {
      contextCount++;
      if (contextCount > contextLines * 2 && currentHunk) {
        // End current hunk
        hunks.push(currentHunk);
        currentHunk = null;
        contextCount = 0;
      }
    } else {
      if (!currentHunk) {
        // Start new hunk
        const startLine = Math.max(1, change.lineNumber - contextLines);
        currentHunk = {
          oldStart: startLine,
          oldLines: 0,
          newStart: startLine,
          newLines: 0,
          lines: []
        };
      }
      
      if (change.type === 'remove') {
        currentHunk.lines.push(`-${change.line}`);
        currentHunk.oldLines++;
      } else if (change.type === 'add') {
        currentHunk.lines.push(`+${change.line}`);
        currentHunk.newLines++;
      }
      
      contextCount = 0;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    filename,
    hunks,
    unifiedDiff: createPatch(filename, originalContent, newContent)
  };
}

/**
 * Get diff statistics
 */
export function getDiffStats(diff: FileDiff): {
  additions: number;
  deletions: number;
  hunks: number;
} {
  let additions = 0;
  let deletions = 0;

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        additions++;
      } else if (line.startsWith('-')) {
        deletions++;
      }
    }
  }

  return {
    additions,
    deletions,
    hunks: diff.hunks.length
  };
}

