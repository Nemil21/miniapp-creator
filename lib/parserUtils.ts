// Robust JSON parsing utilities for multi-stage LLM pipeline responses
import { PatchPlan, DiffHunk } from './llmOptimizer';

/**
 * Helper function to find balanced JSON from a starting index
 */
function findBalancedFromIndex(text: string, startIdx: number): string | null {
  const opening = text[startIdx];
  const matching = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!matching) return null;

  const stack = [opening];
  let inString = false;
  let stringChar: string | null = null;
  let escape = false;

  for (let i = startIdx + 1; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!inString) {
        inString = true;
        stringChar = ch;
        continue;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
        continue;
      } else {
        // different quote inside string - ignore
        continue;
      }
    }

    if (!inString) {
      if (ch === '{' || ch === '[') {
        stack.push(ch);
      } else if (ch === '}' || ch === ']') {
        const last = stack.pop();
        if (!last) return null; // mismatch
        // If stack emptied, we found balanced block
        if (stack.length === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  return null; // no balanced block found (possibly truncated)
}

/**
 * Find the first balanced JSON object/array
 */
function findFirstBalancedJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const found = findBalancedFromIndex(text, i);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Escape control characters inside strings
 */
function escapeControlCharsInsideStrings(src: string): string {
  let out = '';
  let inString = false;
  let stringChar: string | null = null;
  let escaping = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaping = true;
      continue;
    }

    if ((ch === '"' || ch === "'")) {
      if (!inString) {
        inString = true;
        stringChar = ch;
        out += ch;
        continue;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
        out += ch;
        continue;
      } else {
        out += ch;
        continue;
      }
    }

    if (inString) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    } else {
      out += ch;
    }
  }

  return out;
}

/**
 * Remove trailing commas like: ,} or ,]
 */
function removeTrailingCommas(jsonLike: string): string {
  return jsonLike.replace(/,\s*(?=[}\]])/g, '');
}

/**
 * Try to parse JSON with sanitization
 */
function tryParseJsonText(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // try sanitization
    try {
      let s = escapeControlCharsInsideStrings(raw);
      s = removeTrailingCommas(s);
      return JSON.parse(s);
    } catch (e2) {
      throw e2;
    }
  }
}

/**
 * Extract patches array as object
 */
function extractPatchesArrayAsObject(text: string): string | null {
  const key = '"patches"';
  const keyIdx = text.indexOf(key);
  if (keyIdx === -1) return null;

  const colonIdx = text.indexOf(':', keyIdx + key.length);
  if (colonIdx === -1) return null;

  const arrOpen = text.indexOf('[', colonIdx);
  if (arrOpen === -1) return null;

  const balancedArr = findBalancedFromIndex(text, arrOpen);
  if (!balancedArr) return null;

  return `{"patches": ${balancedArr}}`;
}

/**
 * Parse Stage 2 Patch Planner response with robust JSON parsing
 */
export function parseStage2PatchResponse(responseText: string): PatchPlan {
  // 1) Quick exact JSON extraction between markers if present
  const startMarker = '__START_JSON__';
  const endMarker = '__END_JSON__';
  const startMarkIdx = responseText.indexOf(startMarker);
  const endMarkIdx = responseText.indexOf(endMarker, startMarkIdx + startMarker.length);
  if (startMarkIdx !== -1 && endMarkIdx !== -1) {
    const candidate = responseText.slice(startMarkIdx + startMarker.length, endMarkIdx).trim();
    try {
      return tryParseJsonText(candidate) as PatchPlan;
    } catch (e) {
      console.warn('Parsing between markers failed:', e);
    }
  }

  // 2) Try to find the first balanced JSON object/array anywhere
  const balanced = findFirstBalancedJson(responseText);
  if (balanced) {
    try {
      return tryParseJsonText(balanced) as PatchPlan;
    } catch (e) {
      console.warn('Parsing balanced JSON failed, attempting sanitization...', e);
    }
  }

  // 3) Try to extract just the "patches" array and build a minimal object
  const patchesObjText = extractPatchesArrayAsObject(responseText);
  if (patchesObjText) {
    try {
      return tryParseJsonText(patchesObjText) as PatchPlan;
    } catch (e) {
      console.warn('Parsing extracted patches object failed:', e);
    }
  }

  // 4) Last resort: create a minimal valid patch plan
  console.log('All JSON parsing strategies failed, creating minimal patch plan...');
  return {
    patches: [{
      filename: "src/app/page.tsx",
      operation: "modify",
      purpose: "Update main page for the requested miniapp",
      changes: [{
        type: "replace",
        target: "content",
        description: "Replace page content with the requested functionality",
        location: "main content area"
      }],
      diffHunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-// Original content", "+// Updated content"]
      }],
      unifiedDiff: "@@ -1,1 +1,1 @@\n-// Original content\n+// Updated content"
    }]
  };
}

/**
 * Sanitize Stage 3 response by removing unexpected fields that may have been included by mistake
 */
function sanitizeStage3Response(parsed: Array<{ filename: string; content?: string; unifiedDiff?: string; operation?: string; diffHunks?: DiffHunk[] }>): { filename: string; content?: string; unifiedDiff?: string; operation?: string; diffHunks?: DiffHunk[] }[] {
  return parsed.map(item => {
    const sanitized: { filename: string; content?: string; unifiedDiff?: string; operation?: string; diffHunks?: DiffHunk[] } = {
      filename: item.filename,
      operation: item.operation || 'modify'
    };
    
    // Only include valid Stage 3 fields
    if (item.content !== undefined) sanitized.content = item.content;
    if (item.unifiedDiff !== undefined) sanitized.unifiedDiff = item.unifiedDiff;
    if (item.diffHunks !== undefined) sanitized.diffHunks = item.diffHunks;
    
    // Remove unexpected fields like: changes, implementationNotes, intentSpec, dependencies, etc.
    // These are Stage 2 fields that sometimes leak into Stage 3 responses
    
    return sanitized;
  });
}

/**
 * Parse Stage 3 Code Generator response with robust JSON parsing
 */
export function parseStage3CodeResponse(responseText: string): { filename: string; content?: string; unifiedDiff?: string; operation?: string; diffHunks?: DiffHunk[] }[] {
  // 1) Quick exact JSON extraction between markers if present
  const startMarker = '__START_JSON__';
  const endMarker = '__END_JSON__';
  const startMarkIdx = responseText.indexOf(startMarker);
  const endMarkIdx = responseText.indexOf(endMarker, startMarkIdx + startMarker.length);
  if (startMarkIdx !== -1 && endMarkIdx !== -1) {
    const candidate = responseText.slice(startMarkIdx + startMarker.length, endMarkIdx).trim();
    try {
      const parsed = tryParseJsonText(candidate);
      return sanitizeStage3Response(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      console.warn('Stage 3: Parsing between markers failed, attempting repairs:', e);
      
      // Attempt JSON repair
      const repaired = repairJsonArray(candidate);
      if (repaired) {
        try {
          const parsed = tryParseJsonText(repaired);
          return sanitizeStage3Response(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (repairError) {
          console.warn('Stage 3: JSON repair also failed:', repairError);
        }
      }
    }
  }

  // 2) Try to find the first balanced JSON array
  const balanced = findFirstBalancedJson(responseText);
  if (balanced) {
    try {
      const parsed = tryParseJsonText(balanced);
      return sanitizeStage3Response(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      console.warn('Stage 3: Parsing balanced JSON failed:', e);
    }
  }

  // 3) Fallback: try direct parsing
  try {
    const parsed = JSON.parse(responseText);
    return sanitizeStage3Response(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    throw new Error('Stage 3: All JSON parsing strategies failed');
  }
}

/**
 * Attempt to repair common JSON malformation issues
 */
function repairJsonArray(jsonText: string): string | null {
  try {
    let repaired = jsonText.trim();
    
    // Fix malformed content strings with unescaped quotes and newlines
    // This is the most common issue with Stage 3 responses
    
    // Fix unescaped quotes in content fields
    // Pattern: "content": "some text with "quotes" and 'quotes'"
    repaired = repaired.replace(
      /("content"\s*:\s*")([^"\\\\]*(?:\\\\.[^"\\\\]*)*)(")(?=[^"]*(?:"[^"]*"[^"]*)*}])/g,
      (match, prefix, content, suffix) => {
        // Escape any unescaped quotes inside the content
        const escapedContent = content
          .replace(/(?<!\\)"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return prefix + escapedContent + suffix;
      }
    );
    
    // Fix malformed ending patterns
    // [{"filename":"...","content":"..."} -> [{"filename":"...","content":"..."}]
    if (repaired.endsWith('}') && !repaired.endsWith('}]')) {
      repaired = repaired + ']';
    }
    
    // Remove any extra closing braces before final ]
    if (repaired.includes('}]')) {
      repaired = repaired.replace(/}+(?=\s*])/g, '');
    }
    
    // Fix malformed unifiedDiff content escaping
    repaired = repaired.replace(
      /("unifiedDiff"\s*:\s*")([^"\\\\]*(?:\\\\.[^"\\\\]*)*)(")/g,
      (match, prefix, content, suffix) => {
        const escapedContent = content
          .replace(/(?<!\\)"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return prefix + escapedContent + suffix;
      }
    );
    
    // Try parsing the repaired JSON
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

/**
 * Parse Stage 4 Validator response with robust JSON parsing
 */
export function parseStage4ValidatorResponse(responseText: string): { filename: string; content: string; unifiedDiff?: string; diffHunks?: DiffHunk[] }[] {
  // 1) Quick exact JSON extraction between markers if present
  const startMarker = '__START_JSON__';
  const endMarker = '__END_JSON__';
  const startMarkIdx = responseText.indexOf(startMarker);
  const endMarkIdx = responseText.indexOf(endMarker, startMarkIdx + startMarker.length);
  if (startMarkIdx !== -1 && endMarkIdx !== -1) {
    const candidate = responseText.slice(startMarkIdx + startMarker.length, endMarkIdx).trim();
    try {
      return tryParseJsonText(candidate) as { filename: string; content: string; unifiedDiff?: string; diffHunks?: DiffHunk[] }[];
    } catch (e) {
      console.warn('Stage 4: Parsing between markers failed:', e);
    }
  }

  // 2) Try to find the first balanced JSON array
  const balanced = findFirstBalancedJson(responseText);
  if (balanced) {
    try {
      return tryParseJsonText(balanced) as { filename: string; content: string; unifiedDiff?: string; diffHunks?: DiffHunk[] }[];
    } catch (e) {
      console.warn('Stage 4: Parsing balanced JSON failed:', e);
    }
  }

  // 3) Fallback: try direct parsing
  try {
    return JSON.parse(responseText) as { filename: string; content: string; unifiedDiff?: string; diffHunks?: DiffHunk[] }[];
  } catch {
    throw new Error('Stage 4: All JSON parsing strategies failed');
  }
}

/**
 * Generic JSON parser that can be used for any stage
 */
export function parseJsonResponse(responseText: string, stageName: string = 'Unknown'): unknown {
  // 1) Quick exact JSON extraction between markers if present
  const startMarker = '__START_JSON__';
  const endMarker = '__END_JSON__';
  const startMarkIdx = responseText.indexOf(startMarker);
  const endMarkIdx = responseText.indexOf(endMarker, startMarkIdx + startMarker.length);
  if (startMarkIdx !== -1 && endMarkIdx !== -1) {
    const candidate = responseText.slice(startMarkIdx + startMarker.length, endMarkIdx).trim();
    try {
      return tryParseJsonText(candidate);
    } catch (e) {
      console.warn(`${stageName}: Parsing between markers failed:`, e);
    }
  }

  // 2) Try to find the first balanced JSON object/array
  const balanced = findFirstBalancedJson(responseText);
  if (balanced) {
    try {
      return tryParseJsonText(balanced);
    } catch (e) {
      console.warn(`${stageName}: Parsing balanced JSON failed:`, e);
    }
  }

  // 3) Fallback: try direct parsing
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`${stageName}: All JSON parsing strategies failed`);
  }
}

/**
 * Check if response appears to be truncated
 */
export function isResponseTruncated(responseText: string): boolean {
  // Check for Stage 2 truncation (patch planner)
  const isStage2Truncated = responseText.includes('"patches": [') && 
    !responseText.includes('__END_JSON__') && 
    !responseText.trim().endsWith('}') && 
    !responseText.trim().endsWith(']');
  
  // Check for Stage 3 truncation (code generator)
  const isStage3Truncated = responseText.includes('__START_JSON__') && 
    responseText.includes('[') && 
    !responseText.includes('__END_JSON__') && 
    !responseText.trim().endsWith(']') &&
    !responseText.trim().endsWith('}');
  
  // Check for general JSON truncation (missing closing brackets)
  const hasStartJson = responseText.includes('__START_JSON__');
  const hasEndJson = responseText.includes('__END_JSON__');
  const endsProperly = responseText.trim().endsWith(']') || responseText.trim().endsWith('}');
  
  const isGeneralTruncated = hasStartJson && !hasEndJson && !endsProperly;
  
  return isStage2Truncated || isStage3Truncated || isGeneralTruncated;
}

/**
 * Extract JSON content between markers
 */
export function extractJsonBetweenMarkers(
  responseText: string, 
  startMarker: string = '__START_JSON__', 
  endMarker: string = '__END_JSON__'
): string | null {
  const startMarkIdx = responseText.indexOf(startMarker);
  const endMarkIdx = responseText.indexOf(endMarker, startMarkIdx + startMarker.length);
  
  if (startMarkIdx !== -1 && endMarkIdx !== -1) {
    return responseText.slice(startMarkIdx + startMarker.length, endMarkIdx).trim();
  }
  
  return null;
}
