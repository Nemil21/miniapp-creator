// Multi-stage LLM optimization utilities for Farcaster Miniapp generation

// Anthropic Model Selection for Different Stages
export const ANTHROPIC_MODELS = {
  // Fast, cost-effective for simple tasks
  FAST: "claude-3-5-haiku-20241022",
  // Balanced performance for most tasks
  BALANCED: "claude-3-7-sonnet-20250219",
  // High performance for complex tasks
  // POWERFUL: "claude-3-7-sonnet-20250219",
  POWERFUL: "claude-sonnet-4-20250514",
} as const;

// Model selection strategy for each stage with fallbacks
export const STAGE_MODEL_CONFIG = {
  STAGE_0_CONTEXT_GATHERER: {
    model: ANTHROPIC_MODELS.FAST,
    fallbackModel: ANTHROPIC_MODELS.BALANCED,
    maxTokens: 2000,
    temperature: 0,
    reason: "Context gathering needs to be fast and efficient",
  },
  STAGE_1_INTENT_PARSER: {
    model: ANTHROPIC_MODELS.FAST,
    fallbackModel: ANTHROPIC_MODELS.BALANCED, // Use Sonnet if Haiku is overloaded
    maxTokens: 4000,
    temperature: 0,
    reason: "Simple JSON parsing task, fast model sufficient",
  },
  STAGE_2_PATCH_PLANNER: {
    model: ANTHROPIC_MODELS.BALANCED,
    fallbackModel: ANTHROPIC_MODELS.POWERFUL, // Use latest Sonnet if regular Sonnet is overloaded
    maxTokens: 4000,
    temperature: 0,
    reason: "Complex planning task, needs good reasoning",
  },
  STAGE_3_CODE_GENERATOR: {
    model: ANTHROPIC_MODELS.POWERFUL,
    fallbackModel: ANTHROPIC_MODELS.BALANCED, // Use regular Sonnet if latest Sonnet is overloaded
    maxTokens: 20000,
    temperature: 0.1,
    reason: "Complex code generation, needs highest quality",
  },
  STAGE_4_VALIDATOR: {
    model: ANTHROPIC_MODELS.POWERFUL,
    fallbackModel: ANTHROPIC_MODELS.BALANCED, // Use Haiku if Sonnet is overloaded
    maxTokens: 20000,
    temperature: 0,
    reason: "Error fixing requires good reasoning but not highest tier",
  },
  LEGACY_SINGLE_STAGE: {
    model: ANTHROPIC_MODELS.POWERFUL,
    fallbackModel: ANTHROPIC_MODELS.BALANCED, // Use regular Sonnet if latest Sonnet is overloaded
    maxTokens: 20000,
    temperature: 0,
    reason: "Single-stage does everything, needs highest quality",
  },
} as const;

// Farcaster Miniapp Boilerplate Structure
const BOILERPLATE_STRUCTURE = `
farcaster-miniapp/
├── public/
│   ├── .well-known/
│   │   └── farcaster.json          # Farcaster manifest (optional)
│   └── (static files)              # Icons, images, etc.
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with providers
│   │   ├── page.tsx                # Main app component with tabs
│   │   ├── providers.tsx           # SDK and wallet providers
│   │   ├── globals.css             # Global styles
│   │   ├── favicon.ico             # App favicon
│   │   └── api/                    # API routes
│   │       └── me/                 # User authentication endpoint
│   │           └── route.ts        # Farcaster Quick Auth API
│   ├── components/
│   │   ├── ui/                     # Reusable UI components
│   │   │   ├── Button.tsx          # Styled button component
│   │   │   ├── Input.tsx           # Styled input component
│   │   │   └── Tabs.tsx            # Tab navigation component
│   │   ├── auth/                   # Authentication components
│   │   └── wallet/                 # Wallet integration
│   │       └── ConnectWallet.tsx   # Wallet connection UI
│   ├── hooks/                      # Custom React hooks
│   │   ├── useUser.ts              # Unified user hook (Farcaster + Wallet)
│   │   └── index.ts                # Hook exports
│   ├── lib/
│   │   ├── utils.ts                # Utility functions (cn, truncateAddress)
│   │   └── wagmi.ts                # Web3 configuration
│   └── types/
│       └── index.ts                # TypeScript definitions
├── package.json                    # Dependencies
├── next.config.ts                  # Next.js configuration
├── tsconfig.json                   # TypeScript configuration
├── eslint.config.mjs               # ESLint configuration
├── postcss.config.mjs              # PostCSS configuration
├── next-env.d.ts                   # Next.js types
├── .gitignore                      # Git ignore file
└── README.md                       # Project documentation
`;

// Enhanced boilerplate context with available features
const FARCASTER_BOILERPLATE_CONTEXT = {
  structure: BOILERPLATE_STRUCTURE,
  availableFeatures: {
    sdk: "@farcaster/miniapp-sdk",
    wallet: "@farcaster/miniapp-wagmi-connector",
    ui: "Available UI components: Button, Input, ConnectWallet, Tabs",
    hooks: "useUser hook for unified user data",
    contracts:
      "Wagmi hooks: useReadContract, useWriteContract, useWaitForTransactionReceipt",
    environment: "Automatic environment detection (sdk.isInMiniApp())",
    navigation: "Tab-based single page application",
  },
  constraints: {
    mobileFirst: "375px width, touch targets ≥44px",
    singlePage: "Tab-based SPA, all logic in src/app/page.tsx",
    connectors:
      "Only farcasterMiniApp() from @farcaster/miniapp-wagmi-connector",
    userManagement: "Always use useUser hook from @/hooks for user data",
    noPackageChanges: "Do not modify package.json unless absolutely necessary",
    wagmiConfig: "Do not modify wagmi.ts - it has everything needed",
  },
  keyComponents: {
    useUser: {
      location: "src/hooks/useUser.ts",
      purpose: "Unified user authentication for Farcaster miniapp and browser",
      usage: "const { username, fid, isMiniApp, isLoading } = useUser()",
      features: [
        "Auto-detects Farcaster miniapp vs browser",
        "Provides Farcaster user data (fid, username, displayName, pfpUrl)",
        "Handles loading states and errors",
        "Single source of truth for user data",
      ],
    },
    tabs: {
      location: "src/components/ui/Tabs.tsx",
      purpose: "Mobile-friendly tab navigation",
      usage:
        "Import Tabs component and pass tabs array with id, title, content",
    },
    layout: {
      location: "src/app/page.tsx",
      structure: "Header + Tab Navigation + Content areas",
      responsive: "Mobile-first design with proper spacing",
    },
  },
};

// Stage 0: Context Gatherer Types and Prompts
//
// PURPOSE: Stage 0 determines if additional context is needed before processing the user request.
// It can request tool calls to explore the codebase and gather information.
//
// KEY PRINCIPLE: GATHER CONTEXT FIRST - UNDERSTAND THE CODEBASE BEFORE MAKING CHANGES
//
export interface ContextGatheringResult {
  needsContext: boolean;
  toolCalls: Array<{
    tool: string;
    args: string[];
    workingDirectory?: string;
    reason: string;
  }>;
  contextSummary?: string;
}

export function getStage0ContextGathererPrompt(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[]
): string {
  return `
ROLE: Context Gatherer for Farcaster Miniapp

TASK: Analyze if additional context is needed before processing the user request. If the request is vague or requires understanding existing code structure, request tool calls to gather context.

USER REQUEST: ${userPrompt}

CURRENT FILES AVAILABLE:
${currentFiles.map(f => `- ${f.filename}`).join('\n')}

AVAILABLE TOOLS:
- grep: Search for patterns in files
- find: Find files by name or type
- tree: Show directory structure
- cat: Read file contents
- head/tail: Show first/last lines of files
- wc: Count lines, words, characters
- ls: List directory contents

CRITICAL: You MUST return ONLY valid JSON. No explanations, no text, no markdown, no code fences.

OUTPUT FORMAT (JSON ONLY):
{
  "needsContext": boolean,
  "toolCalls": [
    {
      "tool": "grep",
      "args": ["pattern", "file_path"],
      "workingDirectory": "src",
      "reason": "Need to find all instances of useState hook usage"
    }
  ],
  "contextSummary": "Brief summary of what context is being gathered"
}

DECISION RULES:
- If user request is specific and clear (e.g., "Add a button to Tab1"), set needsContext: false
- If user request is vague (e.g., "Fix the bug", "Improve the UI"), set needsContext: true
- If user mentions specific files/functions but they're not in current files, set needsContext: true
- If user wants to modify existing functionality, set needsContext: true
- Always provide clear reason for each tool call
- Limit to 3 tool calls maximum
- Use workingDirectory to scope searches appropriately

EXAMPLES:

User: "Add a token airdrop feature"
Output: {"needsContext": true, "toolCalls": [{"tool": "grep", "args": ["useAccount|useUser", "src"], "workingDirectory": "src", "reason": "Need to understand current wallet integration"}], "contextSummary": "Understanding wallet integration for token airdrop"}

User: "Change the button color in Tab1 to blue"
Output: {"needsContext": false, "toolCalls": [], "contextSummary": "Specific UI change, no additional context needed"}

User: "Fix the bug in the voting system"
Output: {"needsContext": true, "toolCalls": [{"tool": "grep", "args": ["voting|vote|poll", "src"], "workingDirectory": "src", "reason": "Need to find voting-related code to understand the bug"}], "contextSummary": "Finding voting system code to identify the bug"}

REMEMBER: Return ONLY the JSON object above. No other text, no explanations, no markdown formatting.
`;
}

// Stage 1: Intent Parser Types and Prompts
export interface IntentSpec {
  feature: string;
  requirements: string[];
  targetFiles: string[];
  dependencies: string[];
  contractInteractions?: {
    reads: string[];
    writes: string[];
  };
  // New field to indicate if changes are needed
  needsChanges: boolean;
  reason?: string; // Why changes are needed or not needed
}

export function getStage1IntentParserPrompt(): string {
  return `
ROLE: Intent Parser for Farcaster Miniapp Generation

TASK: Parse user request into structured JSON specification and determine if changes are needed

BOILERPLATE CONTEXT:
${JSON.stringify(FARCASTER_BOILERPLATE_CONTEXT, null, 2)}

AVAILABLE FEATURES:
- Farcaster SDK integration (@farcaster/miniapp-sdk)
- Wallet connection (farcasterMiniApp() from @farcaster/miniapp-wagmi-connector)
- ALWAYS use useUser hook from @/hooks for user data like username, fid, displayName, pfpUrl, etc. and always take address from useAccount hook from wagmi
- Tab-based single page application (Tabs component from @/components/ui/Tabs)
- Mobile-first UI components (Button, Input, ConnectWallet, Tabs)
- Automatic environment detection (Mini App vs Browser)
- Pre-configured API endpoint for Farcaster authentication (/api/me)
- Do not change wagmi.ts file - it has everything you need
- Do not modify package.json unless absolutely necessary

CRITICAL: You MUST return ONLY valid JSON. No explanations, no text, no markdown, no code fences.

CURRENT PACKAGE.JSON:
${JSON.stringify(
  {
    name: "farcaster-miniapp",
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
    },
    dependencies: {
      "@farcaster/miniapp-sdk": "^0.1.7",
      "@farcaster/miniapp-wagmi-connector": "^1.0.0",
      "@farcaster/quick-auth": "^0.0.7",
      "@rainbow-me/rainbowkit": "^2.0.0",
      "@tanstack/react-query": "^5.83.0",
      "class-variance-authority": "^0.7.0",
      clsx: "^2.1.0",
      ethers: "^6.11.0",
      "lucide-react": "^0.525.0",
      next: "15.2.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      viem: "^2.7.0",
      wagmi: "^2.5.0",
    },
    devDependencies: {
      "@eslint/eslintrc": "^3",
      "@tailwindcss/postcss": "^4",
      "@types/node": "^20",
      "@types/react": "^19",
      "@types/react-dom": "^19",
      eslint: "^9",
      "eslint-config-next": "15.2.0",
      tailwindcss: "^4",
      typescript: "^5",
    },
  },
  null,
  2
)}

OUTPUT FORMAT (JSON ONLY):
{
  "feature": "string describing main feature",
  "requirements": ["list", "of", "requirements"],
  "targetFiles": ["files", "to", "modify"],
  "dependencies": ["npm", "packages", "needed"],
  "needsChanges": boolean,
  "reason": "string explaining why changes are/aren't needed",
  "contractInteractions": {
    "reads": ["contract functions to read"],
    "writes": ["contract functions to write"]
  }
}

RULES:
- If user just asks for "miniapp" without specific features → needsChanges: false
- If user asks for specific functionality → needsChanges: true
- If functionality involves blockchain (e.g., polls, votes, tokens, airdrops, etc.) → prioritize Web3 integration
- Analyze user intent carefully
- Identify required files to modify (empty array if no changes needed)
- List all npm dependencies needed (empty array if no changes needed)
- Specify contract interactions if any
- Provide clear reason for decision
- Return valid JSON only
- NO EXPLANATIONS, NO TEXT, ONLY JSON

EXAMPLE  1:
User: “Create a miniapp with a token airdrop component”
Output:
{
  "feature": "Token Airdrop",
  "requirements": ["Create a token airdrop component in Tab1", "Display a list of recipients", "Allow users to claim tokens", "Use useAccount hook from wagmi for wallet address"],
  "targetFiles": ["src/app/page.tsx"],
  "dependencies": [],
  "needsChanges": true,
  "reason": "Token airdrop requires new UI and contract integration in tabs",
  "contractInteractions": {
    "reads": ["fetchTokenBalance", "fetchTokenAllowance", "fetchTokenTotalSupply"],
    "writes": ["transferTokens", "approveTokens", "mintTokens", "burnTokens"]
  }
}

EXAMPLE 2:
User: “Create miniapp”
Output:
{"feature":"bootstrap","requirements":[],"targetFiles":[],"dependencies":[],"needsChanges":false,"reason":"no specific feature","contractInteractions":{"reads":[],"writes":[]}}

EXAMPLE 3:
User: “Add polls feature to miniapp”
Output:
{"feature":"polls","requirements":["createPoll","castVote","fetchPollResults","display in tabs","use useUser for authentication"],"targetFiles":["src/app/page.tsx"],"dependencies":[],"needsChanges":true,"reason":"polls require new UI and contract integration in tab layout","contractInteractions":{"reads":["fetchPollResults","getPollById"],"writes":["createPoll","castVote"]}}
REMEMBER: Return ONLY the JSON object above. No other text, no explanations, no markdown formatting.
`;
}

// Stage 2: Patch Planner Types and Prompts
//
// PURPOSE: Stage 2 creates DETAILED PLANNING without generating actual code.
// It provides comprehensive descriptions of what needs to be implemented so that
// Stage 3 can generate the exact code based on these detailed specifications.
//
// KEY PRINCIPLE: NO CODE GENERATION - ONLY DETAILED PLANNING AND DESCRIPTIONS
//
export interface PatchPlan {
  patches: {
    filename: string;
    operation: "create" | "modify" | "delete";
    purpose: string; // High-level description of what this file change accomplishes
    changes: {
      type: "add" | "replace" | "remove";
      target: string; // e.g., "imports", "tab-content", "function", "component"
      description: string; // Detailed description of what needs to be implemented
      location?: string; // Where in the file (e.g., "inside Tab1 content", "after existing imports")
      dependencies?: string[]; // What this change depends on (hooks, components, etc.)
      contractInteraction?: {
        type: "read" | "write";
        functions: string[];
      };
    }[];
  }[];
  implementationNotes?: string[]; // High-level notes for Stage 3 about implementation approach
}

export function getStage2PatchPlannerPrompt(
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[]
): string {
  return `
ROLE: Patch Planner for Farcaster Miniapp



INTENT: ${JSON.stringify(intentSpec, null, 2)}

CURRENT FILES:
${currentFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

TASK: Plan detailed file changes to implement the intent (NO CODE GENERATION - PLANNING ONLY)

BOILERPLATE CONTEXT:
${JSON.stringify(FARCASTER_BOILERPLATE_CONTEXT, null, 2)}

CRITICAL: You MUST return ONLY valid JSON. No explanations, no text, no markdown, no code fences.

OUTPUT FORMAT (JSON ONLY):
{
  "patches": [
    {
      "filename": "src/app/page.tsx",
      "operation": "modify",
      "purpose": "Add token airdrop functionality to Tab1",
      "changes": [
        {
          "type": "add",
          "target": "imports",
          "description": "Import wagmi hooks for contract interaction (useReadContract, useWriteContract, useWaitForTransactionReceipt)",
          "location": "at the top with other imports"
        },
        {
          "type": "replace",
          "target": "tab-content",
          "description": "Replace Tab1 content with airdrop interface including claim button, eligible tokens display, and transaction status",
          "location": "inside Tab1 content area",
          "dependencies": ["useAccount hook from wagmi for wallet address", "wagmi hooks for contract calls"],
          "contractInteraction": {
            "type": "write",
            "functions": ["claimTokens"]
          }
        }
      ]
    }
  ],
  "implementationNotes": [
    "Use useAccount hook from wagmi to get connected wallet address for contract interactions",
    "Display loading state during transaction",
    "Show success/error states for claim attempts",
    "Use existing Tabs component structure"
  ]
}

CRITICAL REQUIREMENTS:
- Every patch MUST have: filename, operation, purpose, changes
- filename: string (file path)
- operation: "create" | "modify" | "delete"
- purpose: string (high-level description of what this file change accomplishes)
- changes: array of change objects
- Each change MUST have: type, target, description
- type: "add" | "replace" | "remove"
- target: string (e.g., "imports", "tab-content", "function", "component")
- description: string (detailed description of what needs to be implemented - NO ACTUAL CODE)
- location: string (where in the file this change should happen)
- dependencies: array of what this change depends on (hooks, components, etc.)
- contractInteraction: object with type and functions if blockchain interaction needed
- do not change wagmi.ts file it has everything you need
- do not edit package.json or add any extra dependencies to package.json if not needed must be minimal

PLANNING RULES:
- Plan changes for each file that needs modification
- The boilerplate is on nextjs app router with src directory structure so think for the code in that structure only
- ALWAYS use useUser hook from @/hooks for user data like username, fid, displayName, pfpUrl, etc. and always take address from useAccount hook from wagmi
- ALWAYS use Tabs component from @/components/ui/Tabs for navigation
- ALWAYS target tab content areas for feature implementation (Tab1, Tab2, etc.)
- Specify exact operations (create/modify/delete) and clear purposes
- Target specific sections with detailed descriptions:
  * "imports" - what imports to add/modify
  * "tab-content" - which tab content to modify and how
  * "function" - what functions to add/modify
  * "component" - what UI components to add
  * "state" - what state management to add
- Describe implementation requirements without writing actual code
- Include dependencies and contract interactions where relevant
- Ensure all required files are covered with detailed change descriptions
- If blockchain functionality is requested, specify contract interaction types and functions
- Provide implementation notes for Stage 3 guidance
- Return valid JSON only
- Every patch must have a valid changes array with descriptions
- NO ACTUAL CODE, NO EXPLANATIONS, ONLY PLANNING JSON

EXAMPLE PLANNING OUTPUT:
User wants to "Add a voting feature"
Correct Stage 2 Output:
{
  "patches": [
    {
      "filename": "src/app/page.tsx", 
      "operation": "modify",
      "purpose": "Add voting functionality to Tab2 with create poll and vote features",
      "changes": [
        {
          "type": "add",
          "target": "imports",
          "description": "Import wagmi hooks (useReadContract, useWriteContract, useWaitForTransactionReceipt) for voting contract interaction",
          "location": "at the top with existing imports"
        },
        {
          "type": "add",
          "target": "state",
          "description": "Add state for poll creation form (question, options, current poll data, voting status)",
          "location": "inside App component after useUser hook",
          "dependencies": ["useState hook", "useAccount hook from wagmi for connected wallet address"]
        },
        {
          "type": "replace",
          "target": "tab-content",
          "description": "Replace Tab2 content with voting interface including create poll form, active polls list, and voting buttons",
          "location": "inside Tab2 content area",
          "dependencies": ["useAccount hook from wagmi for connected wallet address", "wagmi hooks for contract calls", "Button component"],
          "contractInteraction": {
            "type": "write",
            "functions": ["createPoll", "castVote"]
          }
        }
      ]
    }
  ],
  "implementationNotes": [
    "Use useAccount hook from wagmi to get connected wallet address for voting eligibility",
    "Show loading states during poll creation and voting transactions", 
    "Display success/error messages for all operations",
    "Maintain existing tab structure and mobile-first design"
  ]
}

REMEMBER: Return ONLY the JSON object above. No other text, no explanations, no markdown formatting.
`;
}

// Stage 3: Code Generator Types and Prompts
//
// PURPOSE: Stage 3 generates ACTUAL CODE based on the detailed patch plan from Stage 2.
// It translates the planning descriptions, dependencies, and implementation notes
// into complete, working code files.
//
// KEY PRINCIPLE: FOLLOW PATCH PLAN DESCRIPTIONS EXACTLY - GENERATE COMPLETE CODE
//
export function getStage3CodeGeneratorPrompt(
  patchPlan: PatchPlan,
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[]
): string {
  return `
ROLE: Code Generator for Farcaster Miniapp as single page app

INTENT: ${JSON.stringify(intentSpec, null, 2)}

DETAILED PATCH PLAN: ${JSON.stringify(patchPlan, null, 2)}

CURRENT FILES:
${currentFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

BOILERPLATE CONTEXT:
${JSON.stringify(FARCASTER_BOILERPLATE_CONTEXT, null, 2)}

TASK: Generate complete file contents based on the detailed patch plan descriptions and make it as minimal as possible. For follow-up prompts, modify existing files; for new features, create new files as needed.

IMPLEMENTATION GUIDANCE FROM PATCH PLAN:
- Follow the "purpose" field for each file to understand the overall goal
- Use the "description" field in each change to understand exactly what to implement
- Use the "location" field to know where in the file to place the code
- Use the "dependencies" field to ensure all required imports and hooks are included
- Use the "contractInteraction" field to implement blockchain functionality correctly
- Follow the "implementationNotes" for overall implementation approach

FARCASTER REQUIREMENTS FOR MAIN PAGE:
- Mobile-first design (~375px width) with tab-based layout
- Single page app structure (all content in tab components within src/app/page.tsx)
- For contract interactions use wagmi hooks with address from useAccount hook from wagmi
- Do not change wagmi.ts file - it has everything you need
- Do not edit package.json unless absolutely necessary
- The app automatically works in both Farcaster miniapp and browser environments
-The Mini App SDK exposes an EIP-1193 Ethereum Provider API at sdk.wallet.getEthereumProvider()

CRITICAL: You MUST return ONLY valid JSON. No explanations, no text, no markdown, no code fences.

OUTPUT FORMAT:
Generate a JSON array of complete files:
[
  {"filename": "path/to/file", "content": "complete file content"},
  {"filename": "path/to/file2", "content": "complete file content 2"}
]

CODE GENERATION RULES:
- For existing files: Modify the current file content based on the patch plan
- For new files: Generate complete file contents based on patch plan descriptions
- Use useUser hook from @/hooks for user data: const { username, fid, isMiniApp, isLoading } = useUser()
- Use Tabs component from @/components/ui/Tabs for navigation
- Follow patch plan "purpose" and "description" fields exactly
- Implement code in the exact "location" specified in the patch plan
- Include all "dependencies" listed in the patch plan
- Implement "contractInteraction" functionality when specified
- Follow "implementationNotes" for overall approach
- Include all required imports based on dependencies
- Preserve existing code structure and styling when modifying files
- Only change what's specified in the patch plan - keep other parts intact
- Prefer neutral colors (grays, whites, blacks) with subtle accents
- Use consistent spacing, typography, and visual hierarchy
- Ensure good contrast and accessibility
- Use subtle shadows and borders for depth when appropriate
- If blockchain functionality is requested, include smart contract code in solidity and have a placeholder for the contract address and abi
- Return valid JSON array only
- NO EXPLANATIONS, NO TEXT, ONLY JSON

REMEMBER: Return ONLY the JSON array above. No other text, no explanations, no markdown formatting.
`;
}

// Stage 4: Validator Types and Prompts
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  fixes: {
    filename: string;
    content: string;
  }[];
}

export function getStage4ValidatorPrompt(
  generatedFiles: { filename: string; content: string }[],
  errors: string[]
): string {
  return `
ROLE: Code Validator for Next.js 15 + TypeScript + React

ERRORS FOUND:
${errors.join("\n")}

FILES TO REGENERATE:
${generatedFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

TASK: Fix critical errors that would prevent the project from running

BOILERPLATE CONTEXT:
${JSON.stringify(FARCASTER_BOILERPLATE_CONTEXT, null, 2)}

CRITICAL: Return ONLY a JSON array. No markdown, no code blocks, no explanations.

OUTPUT FORMAT:
[
  {"filename": "EXACT_SAME_FILENAME", "content": "corrected file content"},
  {"filename": "EXACT_SAME_FILENAME2", "content": "corrected file content 2"}
]

CRITICAL FIXES ONLY:

1. SYNTAX ERRORS:
   - Fix missing semicolons, brackets, parentheses
   - Fix invalid JSX syntax
   - Fix import/export statements

2. TYPE ERRORS:
   - Fix missing 'use client' directive for client components
   - Fix basic TypeScript type errors
   - Fix React hook usage errors

3. BUILD ERRORS:
   - Fix missing imports
   - Fix circular dependencies
   - Fix invalid file structure

RULES:
- Return EXACTLY the same filenames provided
- DO NOT create new files
- DO NOT add markdown formatting
- Return ONLY the JSON array
- NO EXPLANATIONS, NO TEXT, NO CODE BLOCKS

CRITICAL: Return ONLY the JSON array above. No other text.
`;
}

// Helper function to get boilerplate context
export function getBoilerplateContext() {
  return {
    structure: BOILERPLATE_STRUCTURE,
    context: FARCASTER_BOILERPLATE_CONTEXT,
  };
}

// Helper function to create user prompt with context
export function createOptimizedUserPrompt(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[]
): string {
  return `USER REQUEST: ${userPrompt}

CURRENT PROJECT FILES:
${currentFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

Follow the System Rules. First PLAN (files + imports), then output CODE as a single JSON array of files.`;
}

// Helper function to validate generated files
export function validateGeneratedFiles(
  files: { filename: string; content: string }[]
): {
  isValid: boolean;
  missingFiles: string[];
} {
  // Only validate that we have at least one file and it's not empty
  if (files.length === 0) {
    console.warn("No files generated");
    return {
      isValid: false,
      missingFiles: ["No files generated"],
    };
  }

  // Check for empty files
  const emptyFiles = files.filter(
    (file) => !file.content || file.content.trim() === ""
  );
  if (emptyFiles.length > 0) {
    console.warn(
      "Empty files detected:",
      emptyFiles.map((f) => f.filename)
    );
    return {
      isValid: false,
      missingFiles: emptyFiles.map((f) => `Empty file: ${f.filename}`),
    };
  }

  // All files are valid
  return {
    isValid: true,
    missingFiles: [],
  };
}

// Helper function to check for missing imports/references
export function validateImportsAndReferences(
  files: { filename: string; content: string }[],
  currentFiles?: { filename: string; content: string }[]
): {
  hasAllImports: boolean;
  missingImports: { file: string; missingImport: string }[];
} {
  const createdFiles = new Set(files.map((f) => f.filename));
  const existingFiles = new Set(currentFiles?.map((f) => f.filename) || []);
  const allAvailableFiles = new Set([...createdFiles, ...existingFiles]);
  const missingImports: { file: string; missingImport: string }[] = [];

  // Common import patterns to check
  const importPatterns = [
    // Relative imports: ./path, ../path, @/path
    /import.*from\s+['"`]([./@][^'"`]+)['"`]/g,
    // Dynamic imports
    /import\(['"`]([./@][^'"`]+)['"`]\)/g,
    // Require statements
    /require\(['"`]([./@][^'"`]+)['"`]\)/g,
  ];

  files.forEach((file) => {
    importPatterns.forEach((pattern) => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(file.content)) !== null) {
        let importPath = match[1];

        // Handle different import path formats
        if (importPath.startsWith("@/")) {
          // Convert @/ to src/
          importPath = importPath.replace("@/", "src/");
        } else if (importPath.startsWith("./")) {
          // Relative to current file's directory
          const fileDir = file.filename.includes("/")
            ? file.filename.substring(0, file.filename.lastIndexOf("/"))
            : "";
          importPath = fileDir
            ? `${fileDir}/${importPath.substring(2)}`
            : importPath.substring(2);
        } else if (importPath.startsWith("../")) {
          // Handle parent directory imports (simplified)
          const fileDir = file.filename.includes("/")
            ? file.filename.substring(0, file.filename.lastIndexOf("/"))
            : "";
          // This is a simplified check - real resolution would be more complex
          if (fileDir) {
            const parentDir = fileDir.includes("/")
              ? fileDir.substring(0, fileDir.lastIndexOf("/"))
              : "";
            importPath = parentDir
              ? `${parentDir}/${importPath.substring(3)}`
              : importPath.substring(3);
          } else {
            importPath = importPath.substring(3);
          }
        }

        // Add common file extensions if missing
        const possibleExtensions = [".ts", ".tsx", ".js", ".jsx", ".sol"];
        let found = false;

        // Check exact path first
        if (allAvailableFiles.has(importPath)) {
          found = true;
        } else {
          // Check with extensions
          for (const ext of possibleExtensions) {
            if (allAvailableFiles.has(importPath + ext)) {
              found = true;
              break;
            }
          }
        }

        // Skip validation for known boilerplate imports that should exist
        const knownBoilerplateImports = [
          "@/components/ui/Button",
          "@/components/ui/Input",
          "@/components/ui/Tabs",
          "@/components/wallet/ConnectWallet",
          "@/hooks",
          "@/hooks/useUser",
          "@/lib/utils",
          "@/lib/wagmi",
          "@/types",
        ];

        const isKnownBoilerplateImport = knownBoilerplateImports.some(
          (known) =>
            importPath.includes(known.replace("@/", "src/")) ||
            (match && match[1] && match[1].includes(known))
        );

        if (
          !found &&
          !importPath.includes("node_modules") &&
          !importPath.startsWith("@/") &&
          !isKnownBoilerplateImport
        ) {
          missingImports.push({
            file: file.filename,
            missingImport: match[1],
          });
        }
      }
    });
  });

  if (missingImports.length > 0) {
    console.warn("Missing imported files:", missingImports);
  }

  return {
    hasAllImports: missingImports.length === 0,
    missingImports,
  };
}

function validateClientDirectives(
  files: { filename: string; content: string }[]
): {
  missingClientDirective: { file: string; reason: string }[];
} {
  const missingClientDirective: { file: string; reason: string }[] = [];

  files.forEach((file) => {
    // Only check for critical client-side features that definitely need 'use client'
    const usesClientHooks = /useState|useEffect/.test(file.content);
    const usesEventHandlers = /onClick|onChange/.test(file.content);
    const hasClientDirective = /"use client"/.test(file.content);

    // Only flag if it's clearly a client component
    if ((usesClientHooks || usesEventHandlers) && !hasClientDirective) {
      missingClientDirective.push({
        file: file.filename,
        reason: "Uses client-side features but missing 'use client' directive",
      });
    }
  });

  return { missingClientDirective };
}

// Simplified validation for critical TypeScript issues only
function validateTypeScriptIssues(
  files: { filename: string; content: string }[]
): {
  typeErrors: { file: string; error: string }[];
} {
  const typeErrors: { file: string; error: string }[] = [];

  files.forEach((file) => {
    const content = file.content;

    // Only check for critical syntax errors that would prevent compilation
    const syntaxErrors = [
      /function\s+\w+\s*\([^)]*\)\s*{/g, // Missing closing brace
      /const\s+\w+\s*=\s*\([^)]*\)\s*=>/g, // Arrow function syntax
      /import\s+.*\s+from\s+['"`][^'"`]*['"`]/g, // Import syntax
    ];

    // Check for basic syntax issues
    const hasSyntaxError = syntaxErrors.some((pattern) => {
      const matches = content.match(pattern);
      return matches && matches.length > 0;
    });

    if (hasSyntaxError) {
      typeErrors.push({
        file: file.filename,
        error: "Potential syntax error - check brackets, semicolons, imports",
      });
    }
  });

  return { typeErrors };
}

// Simplified validation for critical React issues only
function validateReactIssues(files: { filename: string; content: string }[]): {
  reactErrors: { file: string; error: string }[];
} {
  const reactErrors: { file: string; error: string }[] = [];

  files.forEach((file) => {
    const content = file.content;

    // Only check for critical React issues that would prevent compilation
    const hasJSX = /<[A-Z][a-zA-Z]*\s*[^>]*>/g.test(content);
    const hasReactHooks = /use[A-Z][a-zA-Z]*/g.test(content);
    const hasClientDirective = /"use client"/g.test(content);

    // Check if JSX is used without proper setup
    if (hasJSX && !hasClientDirective && hasReactHooks) {
      reactErrors.push({
        file: file.filename,
        error: "JSX with React hooks needs 'use client' directive",
      });
    }
  });

  return { reactErrors };
}

// Multi-stage pipeline orchestrator with detailed logging
export async function executeMultiStagePipeline(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>
): Promise<{ filename: string; content: string }[]> {
  try {
    console.log("🚀 Starting multi-stage pipeline...");
    console.log("📝 User Prompt:", userPrompt);
    console.log("📁 Current Files Count:", currentFiles.length);

    // Stage 0: Context Gatherer
    console.log("\n" + "=".repeat(50));
    console.log("🔍 STAGE 0: Context Gatherer");
    console.log("=".repeat(50));

    const contextPrompt = `USER REQUEST: ${userPrompt}`;
    console.log("📤 Sending to LLM (Stage 0):");
    console.log(
      "System Prompt Length:",
      getStage0ContextGathererPrompt(userPrompt, currentFiles).length,
      "chars"
    );
    console.log("User Prompt:", contextPrompt);

    const startTime0 = Date.now();
    const contextResponse = await callLLM(
      getStage0ContextGathererPrompt(userPrompt, currentFiles),
      contextPrompt,
      "Stage 0: Context Gatherer",
      "STAGE_0_CONTEXT_GATHERER"
    );
    const endTime0 = Date.now();

    console.log("📥 Received from LLM (Stage 0):");
    console.log("Response Length:", contextResponse.length, "chars");
    console.log("Response Time:", endTime0 - startTime0, "ms");
    console.log("Raw Response:", contextResponse.substring(0, 500) + "...");

    let contextResult: ContextGatheringResult;
    try {
      contextResult = JSON.parse(contextResponse);
    } catch (error) {
      console.error("❌ Failed to parse Stage 0 response as JSON:");
      console.error("Raw response:", contextResponse);
      throw new Error(
        `Stage 0 JSON parsing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    console.log("🔍 Context Gathering Result:");
    console.log("Needs Context:", contextResult.needsContext);
    console.log("Tool Calls:", contextResult.toolCalls?.length || 0);
    console.log("Context Summary:", contextResult.contextSummary);

    // Execute tool calls if context is needed
    if (contextResult.needsContext && contextResult.toolCalls?.length) {
      console.log("🔧 Executing tool calls for context gathering...");
      // Note: Tool execution will be handled by the calling function
      // This is a placeholder for the enhanced context gathering
    }

    // Stage 1: Intent Parser
    console.log("\n" + "=".repeat(50));
    console.log("📋 STAGE 1: Intent Parser");
    console.log("=".repeat(50));

    const intentPrompt = `USER REQUEST: ${userPrompt}`;
    console.log("📤 Sending to LLM (Stage 1):");
    console.log(
      "System Prompt Length:",
      getStage1IntentParserPrompt().length,
      "chars"
    );
    console.log("User Prompt:", intentPrompt);

    const startTime1 = Date.now();
    const intentResponse = await callLLM(
      getStage1IntentParserPrompt(),
      intentPrompt,
      "Stage 1: Intent Parser",
      "STAGE_1_INTENT_PARSER"
    );
    const endTime1 = Date.now();

    console.log("📥 Received from LLM (Stage 1):");
    console.log("Response Length:", intentResponse.length, "chars");
    console.log("Response Time:", endTime1 - startTime1, "ms");
    console.log("Raw Response:", intentResponse.substring(0, 500) + "...");

    let intentSpec: IntentSpec;
    try {
      intentSpec = JSON.parse(intentResponse);
    } catch (error) {
      console.error("❌ Failed to parse Stage 1 response as JSON:");
      console.error("Raw response:", intentResponse);
      throw new Error(
        `Stage 1 JSON parsing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate intent spec structure
    if (!intentSpec || typeof intentSpec !== "object") {
      throw new Error("Stage 1 response is not a valid object");
    }

    if (!intentSpec.feature || typeof intentSpec.feature !== "string") {
      throw new Error("Stage 1 response missing 'feature' field");
    }

    if (!Array.isArray(intentSpec.requirements)) {
      throw new Error("Stage 1 response missing 'requirements' array");
    }

    if (!Array.isArray(intentSpec.targetFiles)) {
      throw new Error("Stage 1 response missing 'targetFiles' array");
    }

    if (!Array.isArray(intentSpec.dependencies)) {
      throw new Error("Stage 1 response missing 'dependencies' array");
    }

    if (typeof intentSpec.needsChanges !== "boolean") {
      throw new Error("Stage 1 response missing 'needsChanges' boolean field");
    }

    console.log("✅ Stage 1 complete - Parsed Intent:");
    console.log("  Feature:", intentSpec.feature);
    console.log("  Requirements:", intentSpec.requirements.length);
    console.log("  Target Files:", intentSpec.targetFiles.length);
    console.log("  Dependencies:", intentSpec.dependencies.length);
    console.log("  Needs Changes:", intentSpec.needsChanges);
    console.log("  Reason:", intentSpec.reason);

    // Check if changes are needed
    if (!intentSpec.needsChanges) {
      console.log("\n" + "=".repeat(50));
      console.log("✅ NO CHANGES NEEDED - Using Boilerplate As-Is");
      console.log("=".repeat(50));
      console.log("📋 Reason:", intentSpec.reason);
      console.log("📁 Returning", currentFiles.length, "boilerplate files");
      console.log("🎉 Pipeline completed early - no modifications needed!");
      return currentFiles;
    }

    // Stage 2: Patch Planner
    console.log("\n" + "=".repeat(50));
    console.log("📝 STAGE 2: Patch Planner");
    console.log("=".repeat(50));

    const patchPrompt = `USER REQUEST: ${userPrompt}`;
    console.log("📤 Sending to LLM (Stage 2):");
    console.log(
      "System Prompt Length:",
      getStage2PatchPlannerPrompt(intentSpec, currentFiles).length,
      "chars"
    );
    console.log("User Prompt:", patchPrompt);
    console.log("Intent Spec:", JSON.stringify(intentSpec, null, 2));

    const startTime2 = Date.now();
    const patchResponse = await callLLM(
      getStage2PatchPlannerPrompt(intentSpec, currentFiles),
      patchPrompt,
      "Stage 2: Patch Planner",
      "STAGE_2_PATCH_PLANNER"
    );
    const endTime2 = Date.now();

    console.log("📥 Received from LLM (Stage 2):");
    console.log("Response Length:", patchResponse.length, "chars");
    console.log("Response Time:", endTime2 - startTime2, "ms");
    console.log("Raw Response:", patchResponse.substring(0, 500) + "...");

    let patchPlan: PatchPlan;
    try {
      patchPlan = JSON.parse(patchResponse);
    } catch (error) {
      console.error("❌ Failed to parse Stage 2 response as JSON:");
      console.error("Raw response:", patchResponse);
      throw new Error(
        `Stage 2 JSON parsing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate patch plan structure
    if (!patchPlan.patches || !Array.isArray(patchPlan.patches)) {
      throw new Error(
        "Invalid patch plan: patches array is missing or not an array"
      );
    }

    patchPlan.patches.forEach((patch, index) => {
      // Validate each patch structure
      if (!patch || typeof patch !== "object") {
        console.warn(`⚠️ Invalid patch ${index + 1}: patch is not an object`);
        return;
      }

      if (!patch.filename || typeof patch.filename !== "string") {
        console.warn(
          `⚠️ Invalid patch ${index + 1}: filename is missing or not a string`
        );
        return;
      }

      if (
        !patch.operation ||
        !["create", "modify", "delete"].includes(patch.operation)
      ) {
        console.warn(
          `⚠️ Invalid patch ${index + 1}: operation is missing or invalid`
        );
        return;
      }

      if (!patch.changes || !Array.isArray(patch.changes)) {
        console.warn(
          `⚠️ Invalid patch ${
            index + 1
          }: changes array is missing or not an array`
        );
        return;
      }

      console.log(
        `  Patch ${index + 1}: ${patch.operation} ${patch.filename} (${
          patch.changes.length
        } changes)`
      );
    });

    // Stage 3: Code Generator
    console.log("\n" + "=".repeat(50));
    console.log("💻 STAGE 3: Code Generator");
    console.log("=".repeat(50));

    const codePrompt = `USER REQUEST: ${userPrompt}`;
    console.log("📤 Sending to LLM (Stage 3):");
    console.log(
      "System Prompt Length:",
      getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles).length,
      "chars"
    );
    console.log("User Prompt:", codePrompt);
    console.log(
      "Patch Plan Summary:",
      `${patchPlan.patches.length} patches to process`
    );

    const startTime3 = Date.now();
    const codeResponse = await callLLM(
      getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles),
      codePrompt,
      "Stage 3: Code Generator",
      "STAGE_3_CODE_GENERATOR"
    );
    const endTime3 = Date.now();

    console.log("📥 Received from LLM (Stage 3):");
    console.log("Response Length:", codeResponse.length, "chars");
    console.log("Response Time:", endTime3 - startTime3, "ms");
    console.log("Raw Response:", codeResponse.substring(0, 500) + "...");

    let generatedFiles: { filename: string; content: string }[];
    try {
      generatedFiles = JSON.parse(codeResponse);
    } catch (error) {
      console.error("❌ Failed to parse Stage 3 response as JSON:");
      console.error("Raw response:", codeResponse);
      throw new Error(
        `Stage 3 JSON parsing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate generated files structure
    if (!Array.isArray(generatedFiles)) {
      throw new Error("Stage 3 response is not an array");
    }

    // Validate each file object
    generatedFiles.forEach((file, index) => {
      if (!file || typeof file !== "object") {
        throw new Error(`Stage 3 file ${index + 1} is not a valid object`);
      }
      if (!file.filename || typeof file.filename !== "string") {
        throw new Error(`Stage 3 file ${index + 1} missing 'filename' field`);
      }
      if (!file.content || typeof file.content !== "string") {
        throw new Error(`Stage 3 file ${index + 1} missing 'content' field`);
      }
    });

    console.log("✅ Stage 3 complete - Generated Files:");
    console.log("  Total Files:", generatedFiles.length);
    generatedFiles.forEach((file, index) => {
      console.log(
        `  File ${index + 1}: ${file.filename} (${file.content.length} chars)`
      );
    });

    // Stage 4: Validation & Self-Debug
    console.log("\n" + "=".repeat(50));
    console.log("🔍 STAGE 4: Validation & Self-Debug");
    console.log("=".repeat(50));

    const validation = validateGeneratedFiles(generatedFiles);
    const importValidation = validateImportsAndReferences(
      generatedFiles,
      currentFiles
    );
    const clientDirectiveValidation = validateClientDirectives(generatedFiles);
    const typescriptValidation = validateTypeScriptIssues(generatedFiles);
    const reactValidation = validateReactIssues(generatedFiles);

    console.log("🔍 Validation Results:");
    console.log("  Files Valid:", validation.isValid);
    console.log("  Missing Files:", validation.missingFiles);
    console.log("  Imports Valid:", importValidation.hasAllImports);
    console.log("  Missing Imports:", importValidation.missingImports.length);
    console.log(
      "  Missing 'use client' directive:",
      clientDirectiveValidation.missingClientDirective.length
    );
    console.log("  TypeScript Errors:", typescriptValidation.typeErrors.length);
    console.log("  React Errors:", reactValidation.reactErrors.length);

    let validFiles = generatedFiles;
    let invalidFiles = [];

    // Enhanced validation check - include all validation types
    const hasValidationErrors =
      !validation.isValid ||
      (importValidation.missingImports.length > 0 &&
        generatedFiles.length > 0) ||
      clientDirectiveValidation.missingClientDirective.length > 0 ||
      typescriptValidation.typeErrors.length > 0 ||
      reactValidation.reactErrors.length > 0;

    if (hasValidationErrors) {
      console.log("⚠️ Validation failed, attempting fixes...");
      const errors = [
        ...validation.missingFiles.map((f) => f), // Already formatted as error messages
        ...importValidation.missingImports.map(
          (m) => `Missing import in ${m.file}: ${m.missingImport}`
        ),
        ...clientDirectiveValidation.missingClientDirective.map(
          (m) => `Missing 'use client' directive in ${m.file}: ${m.reason}`
        ),
        ...typescriptValidation.typeErrors.map(
          (t) => `TypeScript error in ${t.file}: ${t.error}`
        ),
        ...reactValidation.reactErrors.map(
          (r) => `React error in ${r.file}: ${r.error}`
        ),
      ];

      console.log("📋 Errors to fix:", errors.length);

      console.log("🔍 Analyzing files for validation...");
      generatedFiles.forEach((file) => {
        const hasMissingImport = importValidation.missingImports.some(
          (m) => m.file === file.filename
        );
        const isMissingFile = validation.missingFiles.some((f) =>
          f.includes(file.filename)
        );
        const isMissingClientDirective =
          clientDirectiveValidation.missingClientDirective.some(
            (m) => m.file === file.filename
          );
        const hasTypeScriptError = typescriptValidation.typeErrors.some(
          (t) => t.file === file.filename
        );
        const hasReactError = reactValidation.reactErrors.some(
          (r) => r.file === file.filename
        );

        console.log(
          `  ${file.filename}: missingImport=${hasMissingImport}, missingFile=${isMissingFile}, missingClient=${isMissingClientDirective}, typescriptError=${hasTypeScriptError}, reactError=${hasReactError}`
        );
      });

      // Enhanced file filtering - include all validation types
      validFiles = generatedFiles.filter((file) => {
        const isMissingFile = validation.missingFiles.some((f) =>
          f.includes(file.filename)
        );
        const isMissingClientDirective =
          clientDirectiveValidation.missingClientDirective.some(
            (m) => m.file === file.filename
          );
        const hasTypeScriptError = typescriptValidation.typeErrors.some(
          (t) => t.file === file.filename
        );
        const hasReactError = reactValidation.reactErrors.some(
          (r) => r.file === file.filename
        );

        // Keep all files unless they have actual validation errors
        return (
          !isMissingFile &&
          !isMissingClientDirective &&
          !hasTypeScriptError &&
          !hasReactError
        );
      });

      invalidFiles = generatedFiles.filter((file) => {
        const isMissingFile = validation.missingFiles.some((f) =>
          f.includes(file.filename)
        );
        const isMissingClientDirective =
          clientDirectiveValidation.missingClientDirective.some(
            (m) => m.file === file.filename
          );
        const hasTypeScriptError = typescriptValidation.typeErrors.some(
          (t) => t.file === file.filename
        );
        const hasReactError = reactValidation.reactErrors.some(
          (r) => r.file === file.filename
        );

        // Mark as invalid if there are any validation errors
        return (
          isMissingFile ||
          isMissingClientDirective ||
          hasTypeScriptError ||
          hasReactError
        );
      });

      console.log("📁 Files to keep:", validFiles.length);
      validFiles.forEach((file) => console.log(`  ✅ Keep: ${file.filename}`));

      console.log("📁 Files to regenerate:", invalidFiles.length);
      invalidFiles.forEach((file) =>
        console.log(`  🔄 Regenerate: ${file.filename}`)
      );

      // Rewrite invalid files using LLM
      const rewrittenFiles = await callLLM(
        getStage4ValidatorPrompt(invalidFiles, errors),
        "Stage 4: Validation & Self-Debug",
        "STAGE_4_VALIDATOR"
      );

      // Parse rewritten files with markdown handling
      let rewrittenFilesParsed: { filename: string; content: string }[];
      try {
        // Clean the response to remove markdown formatting
        let cleanedResponse = rewrittenFiles.trim();

        // Remove markdown code blocks if present
        if (cleanedResponse.startsWith("```json")) {
          cleanedResponse = cleanedResponse.replace(/^```json\s*/, "");
        }
        if (cleanedResponse.startsWith("```")) {
          cleanedResponse = cleanedResponse.replace(/^```\s*/, "");
        }
        if (cleanedResponse.endsWith("```")) {
          cleanedResponse = cleanedResponse.replace(/\s*```$/, "");
        }

        // Remove any leading/trailing whitespace
        cleanedResponse = cleanedResponse.trim();

        rewrittenFilesParsed = JSON.parse(cleanedResponse);
      } catch (error) {
        console.error("❌ Failed to parse rewritten files as JSON:");
        console.error("Raw response:", rewrittenFiles.substring(0, 500));
        throw new Error(
          `Stage 4 JSON parsing failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      // Validate that Stage 4 returned the correct files
      const expectedFilenames = new Set(invalidFiles.map((f) => f.filename));
      const returnedFilenames = new Set(
        rewrittenFilesParsed.map((f) => f.filename)
      );

      console.log("🔍 Stage 4 validation check:");
      console.log(
        `  Expected files: ${Array.from(expectedFilenames).join(", ")}`
      );
      console.log(
        `  Returned files: ${Array.from(returnedFilenames).join(", ")}`
      );

      const missingFiles = Array.from(expectedFilenames).filter(
        (f) => !returnedFilenames.has(f)
      );
      const extraFiles = Array.from(returnedFilenames).filter(
        (f) => !expectedFilenames.has(f)
      );

      if (missingFiles.length > 0) {
        console.warn(`⚠️ Stage 4 missing files: ${missingFiles.join(", ")}`);
      }
      if (extraFiles.length > 0) {
        console.warn(`⚠️ Stage 4 extra files: ${extraFiles.join(", ")}`);
      }

      // Combine valid and rewritten files
      // If Stage 4 didn't return the expected files, keep the original invalid files
      if (missingFiles.length > 0) {
        console.warn(
          "⚠️ Stage 4 didn't return all expected files, keeping original files"
        );
        const fallbackFiles = invalidFiles.filter((f) =>
          missingFiles.includes(f.filename)
        );
        generatedFiles = [
          ...validFiles,
          ...rewrittenFilesParsed,
          ...fallbackFiles,
        ];
      } else {
        generatedFiles = [...validFiles, ...rewrittenFilesParsed];
      }

      console.log("📊 Final file combination:");
      console.log(`  Valid files kept: ${validFiles.length}`);
      console.log(`  Rewritten files: ${rewrittenFilesParsed.length}`);
      console.log(
        `  Fallback files: ${missingFiles.length > 0 ? missingFiles.length : 0}`
      );
      console.log(`  Total final files: ${generatedFiles.length}`);

      // Remove duplicates by filename (keep the last occurrence)
      const uniqueFiles = new Map<
        string,
        { filename: string; content: string }
      >();
      generatedFiles.forEach((file) => {
        uniqueFiles.set(file.filename, file);
      });
      generatedFiles = Array.from(uniqueFiles.values());

      console.log(`  After deduplication: ${generatedFiles.length} files`);
    }

    console.log("✅ Stage 4 complete - Final Files:");
    console.log("  Total Files:", generatedFiles.length);
    generatedFiles.forEach((file, index) => {
      console.log(
        `  File ${index + 1}: ${file.filename} (${file.content.length} chars)`
      );
    });

    // Final Summary
    console.log("\n" + "=".repeat(50));
    console.log("🎉 PIPELINE COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(50));
    console.log("📊 Final Summary:");
    console.log("  Total Files Generated:", generatedFiles.length);
    console.log("  Total Time:", Date.now() - startTime1, "ms");
    console.log("  Files:", generatedFiles.map((f) => f.filename).join(", "));

    return generatedFiles;
  } catch (error) {
    console.error("❌ Multi-stage pipeline failed:");
    console.error("  Error:", error);
    console.error(
      "  Stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

// Helper function to log LLM calls with timing
export async function callLLMWithLogging(
  systemPrompt: string,
  userPrompt: string,
  callLLM: (systemPrompt: string, userPrompt: string) => Promise<string>,
  stageName: string
): Promise<string> {
  console.log(`\n🤖 LLM Call - ${stageName}`);
  console.log("📤 Input:");
  console.log("  System Prompt Length:", systemPrompt.length, "chars");
  console.log("  User Prompt:", userPrompt);

  const startTime = Date.now();
  const response = await callLLM(systemPrompt, userPrompt);
  const endTime = Date.now();

  console.log("📥 Output:");
  console.log("  Response Length:", response.length, "chars");
  console.log("  Response Time:", endTime - startTime, "ms");
  console.log("  Raw Response Preview:", response.substring(0, 300) + "...");

  return response;
}
