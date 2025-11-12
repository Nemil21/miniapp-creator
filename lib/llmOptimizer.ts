import { logger } from "./logger";
// Multi-stage LLM optimization utilities for Farcaster Miniapp generation

import * as fs from 'fs';
import * as path from 'path';
import { parseUnifiedDiff, applyDiffToContent } from './diffUtils';
import { applyDiffsToFiles } from './diffBasedPipeline';
import { generateDiff } from './diffUtils';
import { 
  parseStage2PatchResponse, 
  parseStage3CodeResponse, 
  parseStage4ValidatorResponse,
  isResponseTruncated 
} from './parserUtils';
import { CompilationValidator, CompilationResult, CompilationError, CompilationErrorUtils } from './compilationValidator';
import { createRailwayValidationClient, RailwayValidationResult, RailwayValidationError } from './railwayValidationClient';

// Debug logging utilities
const createDebugLogDir = (projectId: string): string => {
  const debugDir = path.join(process.cwd(), 'debug-logs', projectId);
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  return debugDir;
};

const logStageResponse = (projectId: string, stageName: string, response: string, metadata?: Record<string, unknown>): void => {
  try {
    const logContent = {
      timestamp: new Date().toISOString(),
      stage: stageName,
      projectId,
      metadata,
      responseLength: response.length,
      response: response
    };
    
    // In production (Vercel), use structured console logging instead of file system
    if (process.env.NODE_ENV === 'production') {
      logger.log(`[${stageName}] ${JSON.stringify(logContent)}`);
    } else {
      // In development, still write to files
      const debugDir = createDebugLogDir(projectId);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${stageName}-${timestamp}.log`;
      const filepath = path.join(debugDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(logContent, null, 2));
      logger.log(`📝 Debug log saved: ${filepath}`);
    }
  } catch (error) {
    logger.error('Failed to write debug log:', error);
  }
};

// Anthropic Model Selection for Different Stages
export const ANTHROPIC_MODELS = {
  // Fast, cost-effective for simple tasks
  FAST: "claude-3-5-haiku-20241022",
  // Balanced performance for most tasks
  BALANCED: "claude-sonnet-4-20250514",
  // High performance for complex tasks
  // POWERFUL: "claude-3-7-sonnet-20250219",
  POWERFUL: "claude-sonnet-4-5-20250929",
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
    maxTokens: 16000,
    temperature: 0,
    reason: "Complex planning task, needs good reasoning and more tokens for detailed diffs",
  },
  STAGE_3_CODE_GENERATOR: {
    model: ANTHROPIC_MODELS.POWERFUL,
    fallbackModel: ANTHROPIC_MODELS.BALANCED, // Use regular Sonnet if latest Sonnet is overloaded
    maxTokens: 40000,
    temperature: 0.1,
    reason: "Complex code generation, needs highest quality and more tokens for large projects",
  },
  STAGE_4_VALIDATOR: {
    model: ANTHROPIC_MODELS.BALANCED,
    fallbackModel: ANTHROPIC_MODELS.POWERFUL, // Use Haiku if Sonnet is overloaded
    maxTokens: 10000,
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
├── contracts/                      # Smart contract templates
│   ├── ERC20Template.sol           # Secure ERC20 token template
│   ├── ERC721Template.sol          # Secure ERC721 NFT template
│   ├── EscrowTemplate.sol          # Secure escrow contract template
│   ├── hardhat.config.js           # Hardhat configuration
│   ├── package.json                # Contract dependencies
│   └── scripts/
│       └── deploy.js               # Deployment script
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
    smartContracts: {
      erc20: "ERC20Template.sol - Secure token template with minting, burning, pausable",
      erc721: "ERC721Template.sol - Secure NFT template with metadata, enumerable, batch minting",
      escrow: "EscrowTemplate.sol - Secure escrow with dispute resolution, multi-token support",
      security: "All templates use OpenZeppelin standards with access controls and reentrancy protection"
    },
  },
  constraints: {
    mobileFirst: "375px width, touch targets ≥44px",
    singlePage: "Tab-based SPA, all logic in src/app/page.tsx",
    connectors:
      "🚨 CRITICAL: ONLY farcasterMiniApp() from @farcaster/miniapp-wagmi-connector - NO RainbowKit, NO MetaMask, NO other wallet connectors",
    userManagement: "Always use useUser hook from @/hooks for user data",
    noPackageChanges: "Do not modify package.json unless absolutely necessary",
    wagmiConfig: "For Web3 apps: Modify wagmi.ts to import CHAIN from contractConfig. For non-Web3 apps: Do not modify wagmi.ts",
    noMultiWallet: "🚨 FORBIDDEN: DO NOT import or use @rainbow-me/rainbowkit, MetaMask, WalletConnect, or any multi-wallet providers. Farcaster apps use ONLY farcasterMiniApp connector.",
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

// Web3 Web App Boilerplate Context
const WEB3_BOILERPLATE_CONTEXT = {
  structure: `web3-app/
├── src/
│   ├── app/                        # Next.js app
│   │   ├── page.tsx                # Main page
│   │   ├── providers.tsx           # Wagmi + RainbowKit
│   ├── components/
│   │   ├── ui/                     # Button, Input, Tabs
│   │   └── wallet/
│   │       └── ConnectWallet.tsx   # RainbowKit wallet UI
│   ├── hooks/
│   │   └── useUser.ts              # Simple wallet hook (NO Farcaster)
│   ├── lib/
│   │   ├── utils.ts                # Utilities
│   │   └── wagmi.ts                # Multi-chain config
`,
  availableFeatures: {
    wallets: "MetaMask, Coinbase Wallet (NO WalletConnect without Project ID)",
    chains: "Mainnet, Base, Base Sepolia, Optimism, Arbitrum, Polygon",
    ui: "Button, Input, Tabs, ConnectWallet (RainbowKit)",
    hooks: "useUser - wallet data ONLY (address, balance, ensName)",
    contracts: "useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance",
  },
  constraints: {
    noFarcaster: "🚨 CRITICAL: NO Farcaster SDK, NO miniapp features, NO Farcaster data",
    userManagement: "🚨 useUser returns ONLY: address, isConnected, isConnecting, isDisconnected, balance, balanceFormatted, ensName, chainId",
    forbiddenProperties: "NEVER use: username, fid, displayName, pfpUrl, isMiniApp - these don't exist!",
    singlePage: "Tab-based SPA in src/app/page.tsx",
  },
  keyComponents: {
    useUser: {
      location: "src/hooks/useUser.ts",
      purpose: "Simple Web3 wallet hook - NO FARCASTER",
      correctUsage: "const { address, isConnected, balance, ensName } = useUser()",
      availableFields: "address, isConnected, isConnecting, isDisconnected, balance, balanceFormatted, ensName, chainId",
      forbiddenFields: "username, fid, displayName, pfpUrl, isMiniApp, location",
      example: `
// ✅ CORRECT - Web3 useUser
const { address, isConnected, balance, ensName, chainId } = useUser();
if (isConnected && address) {
  // Use wallet data
}

// ❌ WRONG - These don't exist in Web3!
const { username, fid, isMiniApp } = useUser(); // ERROR!
`,
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
  Usage: {"tool": "grep", "args": ["pattern", "file_or_directory"], "workingDirectory": "src"}
  Example: {"tool": "grep", "args": ["useState", "app/page.tsx"], "workingDirectory": "src"}
  
- cat: Read complete file contents  
  Usage: {"tool": "cat", "args": ["file_path"], "workingDirectory": "src"}
  Example: {"tool": "cat", "args": ["components/TodoList.tsx"], "workingDirectory": "src"}
  
- find: Find files by name pattern
  Usage: {"tool": "find", "args": [".", "-name", "*.tsx"], "workingDirectory": "src"}
  
- ls: List directory contents
  Usage: {"tool": "ls", "args": ["-la", "components"], "workingDirectory": "src"}

TOOL USAGE RULES:
- ALWAYS use "src" as workingDirectory for React components
- For grep: Use specific file paths rather than broad directory searches
- For file paths: Use relative paths from the workingDirectory (e.g., "app/page.tsx", not "src/app/page.tsx")
- Keep patterns simple and specific

🚨 CRITICAL PATTERN RESTRICTIONS:
- DO NOT use pipe character | in grep patterns (e.g., "submit|onSubmit" will FAIL)
- DO NOT use OR patterns - make separate grep calls instead
- ✅ CORRECT: Two calls: grep "submit" and grep "onSubmit"
- ❌ WRONG: One call with "submit|onSubmit"
- Avoid special shell characters: ; & | \` $ < > in patterns

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
  // Web3 classification fields
  isWeb3: boolean; // true if this requires blockchain/smart contracts
  storageType: "blockchain" | "localStorage" | "none"; // How data should be persisted
  // Contract template selection (for Web3 apps)
  contractTemplate?: "ERC20" | "ERC721" | "Escrow" | "none";
  contractName?: string; // e.g., "MyNFT", "RewardToken"
}

export function getStage1IntentParserPrompt(appType: 'farcaster' | 'web3' = 'farcaster'): string {
  const context = getContextForAppType(appType);
  const appTypeName = appType === 'web3' ? 'Web3 Web App' : 'Farcaster Miniapp';
  
  const web3Warning = appType === 'web3' ? `
${'='.repeat(80)}
🚨🚨🚨 CRITICAL: THIS IS A WEB3 WEB APP - NOT A FARCASTER MINI APP! 🚨🚨🚨
${'='.repeat(80)}

THE useUser HOOK IN THIS PROJECT RETURNS **ONLY** WALLET DATA:
  ✅ AVAILABLE: address, isConnected, isConnecting, isDisconnected, balance, balanceFormatted, ensName, chainId
  ❌ FORBIDDEN: username, fid, displayName, pfpUrl, isMiniApp, location, isLoading

⚠️ CRITICAL DIFFERENCES FROM FARCASTER:
  - Use isConnecting NOT isLoading ❌
  - Use address NOT username ❌
  - Use ensName NOT displayName ❌
  - NO profile pictures (pfpUrl) ❌
  - NO Farcaster IDs (fid) ❌

NEVER USE THESE FARCASTER PROPERTIES - THEY DON'T EXIST IN WEB3 APPS:
  - userData.isLoading ❌ → Use userData.isConnecting ✅
  - userData.username ❌ → Use userData.address ✅
  - userData.fid ❌
  - userData.displayName ❌ → Use userData.ensName ✅
  - userData.pfpUrl ❌
  - userData.isMiniApp ❌

CORRECT Web3 useUser USAGE:
  const { address, isConnected, isConnecting, balance, ensName } = useUser();
  if (isConnecting) { return <div>Loading...</div>; }
  if (isConnected && address) { /* use wallet data */ }

${'='.repeat(80)}
` : '';
  
  return `${web3Warning}
ROLE: Intent Parser for ${appTypeName} Generation

TASK: Parse user request into structured JSON specification and determine if changes are needed

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

AVAILABLE FEATURES:
${appType === 'farcaster' ? `
- Farcaster SDK integration (@farcaster/miniapp-sdk)
- 🚨 CRITICAL: Wallet connection ONLY via farcasterMiniApp() - NO MetaMask, NO RainbowKit, NO other wallets
- 🚨 CRITICAL: ALWAYS use useUser hook from @/hooks for user data (username, fid, displayName, pfpUrl)
- 🚨 FORBIDDEN: DO NOT import or use RainbowKit, MetaMask, WalletConnect, or any multi-wallet libraries
- Tab-based single page application
- Mobile-first UI components (Button, Input, ConnectWallet, Tabs)
- Automatic environment detection (Mini App vs Browser)
- Pre-configured API endpoint for Farcaster authentication (/api/me)
- ConnectWallet component uses ONLY wagmi's useConnect hook with farcasterMiniApp connector
` : `
- 🚨 CRITICAL: NO Farcaster SDK - this is a Web3 Web App!
- Multi-wallet support: MetaMask, Coinbase Wallet (via RainbowKit)
- Multi-chain: Mainnet, Base, Optimism, Arbitrum, Polygon
- 🚨 CRITICAL: useUser hook returns ONLY wallet data (address, isConnected, balance, ensName, chainId)
- 🚨 FORBIDDEN: username, fid, displayName, pfpUrl, isMiniApp - THESE DON'T EXIST!
- Tab-based single page application
- Responsive UI components (Button, Input, ConnectWallet with RainbowKit, Tabs)
- Wagmi hooks: useAccount, useBalance, useReadContract, useWriteContract
`}
- Do not modify package.json unless absolutely necessary

🚨 CRITICAL TEMPLATE ENFORCEMENT:
- ONLY use the boilerplate template files provided
- DO NOT create new API routes unless absolutely necessary
- ALWAYS use wagmi hooks (useReadContract, useWriteContract) directly in components
- DO NOT create wrapper API routes for contract interactions
- ONLY modify src/app/page.tsx and create components in src/components/
${appType === 'farcaster' ? '- For Web3 contracts: ONLY modify contracts/ directory' : '- For smart contracts: use wagmi hooks directly'}

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
  },
  "isWeb3": boolean,
  "storageType": "blockchain" | "localStorage" | "none",
  "contractTemplate": "ERC20" | "ERC721" | "Escrow" | "none",
  "contractName": "string (e.g., MyNFT, RewardToken)"
}

RULES:
- If user just asks for "miniapp" without specific features → needsChanges: false
- If user asks for specific functionality → needsChanges: true
- If functionality involves blockchain (e.g., polls, votes, tokens, airdrops, etc.) → prioritize Web3 integration
- Analyze user intent carefully
- Identify required files to modify (empty array if no changes needed)
- List all npm dependencies needed (empty array if no changes needed)
- For IPFS/storage: use “@web3-storage/w3up-client” (current web3.storage client); do not add it unless code actually uses it. Never use “@web3-storage/web3-storage” (does not exist).
- Specify contract interactions if any
- Provide clear reason for decision
- Return valid JSON only
- NO EXPLANATIONS, NO TEXT, ONLY JSON

🚨 WEB3 VS NON-WEB3 CLASSIFICATION (CRITICAL):

Analyze the user request and determine storage strategy:

WEB3 IDEAS (isWeb3: true, storageType: "blockchain"):
- NFT minting, collections, galleries, or trading
- Token creation, transfers, swaps, or management
- DeFi features: staking, lending, liquidity pools, yield farming
- On-chain voting, governance, or polls (where immutability matters)
- Blockchain games with asset ownership or trading
- Crypto airdrops or token distributions
- Smart contract-based escrow or payments
- Any feature requiring trustless, immutable, or decentralized records
- Direct blockchain/contract interactions

NON-WEB3 IDEAS (isWeb3: false, storageType: "localStorage"):
- Social features: posts, likes, comments, followers
- User profiles, preferences, and settings
- Leaderboards, high scores, achievements
- Todo lists, notes, task management, productivity tools
- Content feeds, timelines, news aggregators
- Quiz games, trivia apps, educational content
- Traditional CRUD applications
- Analytics dashboards, data visualization
- Messaging, chat, or communication features
- File uploads, image galleries (non-NFT)
- Any feature that doesn't need blockchain guarantees

CLASSIFICATION EXAMPLES:
✅ "Create a leaderboard app" → isWeb3: false, storageType: "localStorage"
✅ "Build an NFT gallery" → isWeb3: true, storageType: "blockchain"
✅ "Make a voting dApp" → isWeb3: true, storageType: "blockchain"
✅ "Quiz game with scores" → isWeb3: false, storageType: "localStorage"
✅ "Token airdrop app" → isWeb3: true, storageType: "blockchain"
✅ "Todo list miniapp" → isWeb3: false, storageType: "localStorage"
✅ "Social media feed" → isWeb3: false, storageType: "localStorage"
✅ "NFT minting platform" → isWeb3: true, storageType: "blockchain"

IMPORTANT: If unclear, default to non-web3 (localStorage) unless the user explicitly mentions:
- NFTs, tokens, crypto, blockchain, smart contracts, DeFi, on-chain, decentralized

CONTRACT TEMPLATE SELECTION (for Web3 apps only):
If isWeb3: true, select which contract template to use:
- "ERC721": NFTs, collectibles, tickets, badges, digital art
- "ERC20": Tokens, rewards, airdrops, loyalty points, tipping
- "Escrow": Payments, marketplaces, freelance, betting, crowdfunding
- "none": Non-web3 apps

EXAMPLE 1 (Web3 App):
User: "Create a miniapp with a token airdrop component"
Output:
{
  "feature": "Token Airdrop",
  "requirements": ["Create a token airdrop component in Tab1", "Display a list of recipients", "Allow users to claim tokens", "Use useAccount hook from wagmi for wallet address"],
  "targetFiles": ["src/app/page.tsx"],
  "dependencies": [],
  "needsChanges": true,
  "reason": "Token airdrop requires new UI and contract integration in tabs",
  "contractInteractions": {
    "reads": ["balanceOf", "totalSupply"],
    "writes": ["mint", "transfer"]
  },
  "isWeb3": true,
  "storageType": "blockchain",
  "contractTemplate": "ERC20",
  "contractName": "AirdropToken"
}

EXAMPLE 2 (No Changes):
User: "Create miniapp"
Output:
{"feature":"bootstrap","requirements":[],"targetFiles":[],"dependencies":[],"needsChanges":false,"reason":"no specific feature","contractInteractions":{"reads":[],"writes":[]},"isWeb3":false,"storageType":"none","contractTemplate":"none"}

EXAMPLE 3 (Web3 with NFT):
User: "Build an NFT gallery"
Output:
{"feature":"nft-gallery","requirements":["display NFTs","allow minting","use useReadContract for fetching"],"targetFiles":["src/app/page.tsx"],"dependencies":[],"needsChanges":true,"reason":"NFT gallery requires UI and ERC721 integration","contractInteractions":{"reads":["totalSupply","tokenURI","ownerOf"],"writes":["safeMint"]},"isWeb3":true,"storageType":"blockchain","contractTemplate":"ERC721","contractName":"GalleryNFT"}

EXAMPLE 4 (Non-Web3 App):
User: "Create a leaderboard app with high scores"
Output:
{"feature":"leaderboard","requirements":["display top 10 scores","allow users to submit scores","use localStorage for persistence","show empty state when no scores"],"targetFiles":["src/app/page.tsx"],"dependencies":[],"needsChanges":true,"reason":"leaderboard requires new UI and localStorage integration","contractInteractions":{"reads":[],"writes":[]},"isWeb3":false,"storageType":"localStorage","contractTemplate":"none"}
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
    // New diff-based fields
    diffHunks?: DiffHunk[]; // Unified diff hunks for this file
    unifiedDiff?: string; // Full unified diff for this file
  }[];
  implementationNotes?: string[]; // High-level notes for Stage 3 about implementation approach
}

// New interfaces for diff-based patching
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[]; // The actual diff lines with +, -, and context
}

export interface FileDiff {
  filename: string;
  hunks: DiffHunk[];
  unifiedDiff: string;
}

export function getStage2PatchPlannerPrompt(
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[],
  isInitialGeneration: boolean = false,
  appType: 'farcaster' | 'web3' = 'farcaster'
): string {
  const context = getContextForAppType(appType);
  const appTypeName = appType === 'web3' ? 'Web3 Web App' : 'Farcaster Miniapp';
  
  const web3Warning = appType === 'web3' ? `
${'='.repeat(80)}
🚨🚨🚨 CRITICAL: THIS IS A WEB3 WEB APP - NOT A FARCASTER MINI APP! 🚨🚨🚨
${'='.repeat(80)}

THE useUser HOOK RETURNS **ONLY** WALLET DATA - NO FARCASTER DATA:
  ✅ AVAILABLE: address, isConnected, balance, ensName, chainId
  ❌ FORBIDDEN: username, fid, displayName, pfpUrl, isMiniApp

NEVER PLAN TO USE THESE PROPERTIES - THEY DON'T EXIST:
  - userData?.username, userData?.fid, userData?.isMiniApp - ALL FORBIDDEN! ❌

${'='.repeat(80)}
` : '';
  
  if (isInitialGeneration) {
    return `${web3Warning}
ROLE: Patch Planner for ${appTypeName} - Initial Generation

INTENT: ${JSON.stringify(intentSpec, null, 2)}

CURRENT FILES (Boilerplate):
${currentFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

TASK: Plan detailed file changes to implement the intent for initial project generation

INITIAL GENERATION APPROACH:
- Focus on complete file planning rather than surgical diffs
- Plan full file modifications since we're starting from boilerplate
- Generate comprehensive change descriptions for complete implementation
- No need for diff hunks or unified diffs - Stage 3 will generate complete files

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

🚨 CRITICAL TEMPLATE ENFORCEMENT:
- ONLY use the boilerplate template files provided
- DO NOT create new API routes (src/app/api/*) unless absolutely necessary
- ALWAYS use wagmi hooks (useReadContract, useWriteContract) directly in components
- DO NOT create wrapper API routes for contract interactions (e.g., src/app/api/contract/read/route.ts)
- ONLY modify src/app/page.tsx and create components in src/components/
- For Web3: ONLY modify contracts/src/ for smart contracts and contracts/scripts/deploy.js
- Use existing boilerplate patterns: Tabs component, Button, Input, ConnectWallet
- NEVER deviate from boilerplate structure to avoid TypeScript errors

CRITICAL: Return ONLY valid JSON. Surround the JSON with EXACT markers:
__START_JSON__
{ ... your JSON ... }
__END_JSON__
Nothing else before/after the markers. Do not include any explanatory text, comments, or additional content outside the JSON markers.

OUTPUT FORMAT (JSON ONLY) - INITIAL GENERATION:
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

CRITICAL REQUIREMENTS - INITIAL GENERATION:
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
- For Web3 apps: Modify wagmi.ts to import CHAIN from contractConfig. For non-Web3 apps: Do not modify wagmi.ts
- do not edit package.json or add any extra dependencies to package.json if not needed must be minimal

PLANNING RULES:
- Plan changes for each file that needs modification
- The boilerplate is on nextjs app router with src directory structure so think for the code in that structure only
- ALWAYS use useUser hook from @/hooks for user data like username, fid, displayName, pfpUrl, etc. and always take address from useAccount hook from wagmi
- ALWAYS use Tabs component from @/components/ui/Tabs for navigation
- ALWAYS target tab content areas for feature implementation (Tab1, Tab2, etc.)
- Specify exact operations (create/modify/delete) and clear purposes
- 🚨 CRITICAL: NEVER PLAN TO CREATE src/app/api/ ROUTES FOR CONTRACT INTERACTIONS
- 🚨 CRITICAL: USE wagmi hooks (useReadContract, useWriteContract) DIRECTLY IN COMPONENTS
- Target specific sections with detailed descriptions:
  * "imports" - what imports to add/modify
  * "tab-content" - which tab content to modify and how
  * "function" - what functions to add/modify
  * "component" - what UI components to add
  * "state" - what state management to add
- Describe implementation requirements without writing actual code
- Include dependencies and contract interactions where relevant
- Ensure all required files are covered with detailed change descriptions
- 🚨 For Web3 apps (isWeb3: true): Use ONLY existing templates in contracts/src/
  * ERC20Template.sol, ERC721Template.sol, EscrowTemplate.sol
  * DO NOT plan new contract logic - templates already have all needed functions
  * Frontend should integrate with template functions (mint, transfer, etc.)
  * NEVER create or modify hardhat.config.js/ts in root - it stays in contracts/ subdirectory
  * DO NOT move contract config files to root directory - they must stay in contracts/
- Provide implementation notes for Stage 3 guidance
- Return valid JSON only
- Every patch must have a valid changes array with descriptions
- NO ACTUAL CODE, NO EXPLANATIONS, ONLY PLANNING JSON

EXAMPLE PLANNING OUTPUT:
User wants to "Add a voting feature"
Correct Stage 2 Output:
__START_JSON__
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
__END_JSON__

REMEMBER: Return ONLY the JSON object above surrounded by __START_JSON__ and __END_JSON__ markers. No other text, no explanations, no markdown formatting.
`;
  } else {
    // Follow-up changes - use diff-based approach
    return `${web3Warning}
ROLE: Patch Planner for ${appTypeName} - Follow-up Changes

INTENT: ${JSON.stringify(intentSpec, null, 2)}

CURRENT FILES (with line numbers for accurate diff planning):
${currentFiles.map((f) => {
  const lines = f.content.split('\n');
  const numberedContent = lines.map((line, index) => `${(index + 1).toString().padStart(3, ' ')}|${line}`).join('\n');
  return `---${f.filename}---\n${numberedContent}`;
}).join("\n\n")}

TASK: Plan detailed file changes to implement the intent and generate unified diff hunks for surgical changes

🚨 CRITICAL: MINIMAL FILE TARGETING 🚨

BEFORE planning ANY patches, answer these questions:
1. What is the EXACT user request? "${intentSpec.feature || 'user request'}"
2. Which SPECIFIC files need to change to fulfill this request?
3. Are you planning changes to files that DON'T need to change?

RULES FOR FILE SELECTION:
✅ ONLY plan patches for files that DIRECTLY implement the requested feature/fix
✅ If user asks to "fix player 2 interface", ONLY modify the component with player interface logic
✅ If user asks to "add a button", ONLY modify the file containing that UI section
❌ DO NOT plan patches for files that already work correctly
❌ DO NOT plan patches for unrelated components, utilities, or config files
❌ DO NOT plan patches for package.json, tsconfig.json, or build config unless explicitly requested

EXAMPLE - User Request: "fix player 2 interface issue"
✅ CORRECT: Plan 1 patch for src/components/PlayerInterface.tsx (the file with the bug)
❌ WRONG: Plan 33 patches including layout.tsx, Button.tsx, utils.ts, etc. (unrelated files)

EXAMPLE - User Request: "add a new tab for settings"
✅ CORRECT: Plan 1-2 patches for src/app/page.tsx (add tab) and maybe src/components/Settings.tsx (new component)
❌ WRONG: Plan patches for every component file just to "ensure consistency"

VALIDATION BEFORE OUTPUT:
Count your patches. If you have more than 3 patches for a simple request, you're doing it WRONG.
Ask yourself: "Does this file NEED to change to fulfill the user's request?"
If the answer is NO, DELETE that patch from your plan.

DIFF GENERATION REQUIREMENTS - CRITICAL:
- For each file modification, generate unified diff hunks in VALID format: @@ -oldStart,oldLines +newStart,newLines @@
- Use the numbered lines (e.g., "  5|import { useState }") from CURRENT FILES to determine exact line positions
- oldLines and newLines MUST be the ACTUAL count of lines in that section (NEVER use 0)

🚨 SMALL HUNKS RULE - CRITICAL FOR SUCCESS:
- Each hunk MUST be SMALL: maximum 10 total lines
- Include ONLY 2-3 context lines (unchanged lines with space prefix) around changes
- If a function needs multiple changes, split into MULTIPLE SMALL hunks instead of one large hunk
- EXAMPLE: Instead of one 20-line hunk changing 3 parts of a function, create 3 separate 6-8 line hunks
- WHY: Large hunks cause context matching failures. Small hunks have 90%+ success rate.

- Use + prefix for added lines, - prefix for removed lines, space prefix for context lines
- Generate minimal, surgical diffs rather than full file rewrites
- Focus on precise line-by-line changes to preserve existing code structure
- CRITICAL: Always preserve the 'use client'; directive at the very top of React component files
- When adding imports, place them AFTER the 'use client'; directive but BEFORE other imports

UNIFIED DIFF FORMAT VALIDATION:
✅ CORRECT: @@ -5,3 +5,5 @@  (means: old section starts at line 5 with 3 lines, new section starts at line 5 with 5 lines)
✅ CORRECT: @@ -10,7 +10,12 @@ (old: 7 lines starting at 10, new: 12 lines starting at 10)
❌ WRONG: @@ -2,0 +3,1 @@     (NEVER use 0 for oldLines - must be actual count)
❌ WRONG: @@ -5 +5,2 @@        (missing line counts - must include both)

LINE COUNTING WITH NUMBERED CONTENT:
- Use the numbered lines from CURRENT FILES to calculate exact positions
- Count ALL lines in the hunk including context lines, removed lines, and added lines
- oldLines = number of context lines + number of removed lines (lines with - prefix)
- newLines = number of context lines + number of added lines (lines with + prefix)
- Example: To modify line 15, include context from lines 13-14 and 16-17
- If adding 2 new lines with 3 context lines: oldLines=3, newLines=5
- If removing 1 line with 2 context lines: oldLines=3, newLines=2

HUNK VALIDATION CHECKLIST:
- Does the hunk start and end with context lines (space prefix)?
- Do the line counts (oldLines, newLines) match the actual number of lines in the hunk?
- Are the line numbers (oldStart, newStart) correct based on the numbered content?
- Are context lines exactly matching the numbered content from CURRENT FILES?

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

CRITICAL: Return ONLY valid JSON. Surround the JSON with EXACT markers:
__START_JSON__
{ ... your JSON ... }
__END_JSON__
Nothing else before/after the markers. Do not include any explanatory text, comments, or additional content outside the JSON markers.

OUTPUT FORMAT (JSON ONLY) - FOLLOW-UP CHANGES:
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
      ],
      "diffHunks": [
        {
          "oldStart": 1,
          "oldLines": 3,
          "newStart": 1,
          "newLines": 6,
          "lines": [
            "'use client';",
            "",
            " import { ConnectWallet } from '@/components/wallet/ConnectWallet';",
            " import { Tabs } from '@/components/ui/Tabs';",
            "+import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';",
            "+import { useAccount } from 'wagmi';",
            " import { useUser } from '@/hooks';",
            " "
          ]
        }
      ],
      "unifiedDiff": "@@ -1,3 +1,6 @@\n'use client';\n\n import { ConnectWallet } from '@/components/wallet/ConnectWallet';\n import { Tabs } from '@/components/ui/Tabs';\n+import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';\n+import { useAccount } from 'wagmi';\n import { useUser } from '@/hooks';\n \n@@ -40,10 +43,25 @@\n   const tabs = [\n     {\n       id: 'tab1',\n       title: 'Tab1',\n-      content: (\n-        <div className=\"space-y-4\">\n-          <h1>Tab 1 Content</h1>\n-        </div>\n-      )\n+      content: (\n+        <div className=\"space-y-4\">\n+          <h1>Token Airdrop</h1>\n+          <p>Claim your eligible tokens</p>\n+          <button onClick={handleClaim}>Claim Tokens</button>\n+        </div>\n+      )\n     },\n"
    }
  ],
  "implementationNotes": [
    "Use useAccount hook from wagmi to get connected wallet address for contract interactions",
    "Display loading state during transaction",
    "Show success/error states for claim attempts",
    "Use existing Tabs component structure"
  ]
}

CRITICAL REQUIREMENTS - FOLLOW-UP CHANGES:
- Every patch MUST have: filename, operation, purpose, changes, diffHunks, unifiedDiff
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
- diffHunks: array of diff hunk objects with oldStart, oldLines, newStart, newLines, lines
- unifiedDiff: string containing the complete unified diff format for the file
- For Web3 apps: Modify wagmi.ts to include contractConfig imports. For non-Web3 apps: Do not modify wagmi.ts
- do not edit package.json or add any extra dependencies to package.json if not needed must be minimal

PLANNING RULES:
- Plan changes for each file that needs modification
- The boilerplate is on nextjs app router with src directory structure so think for the code in that structure only
- ALWAYS use useUser hook from @/hooks for user data like username, fid, displayName, pfpUrl, etc. and always take address from useAccount hook from wagmi
- ALWAYS use Tabs component from @/components/ui/Tabs for navigation
- ALWAYS target tab content areas for feature implementation (Tab1, Tab2, etc.)
- Specify exact operations (create/modify/delete) and clear purposes
- 🚨 CRITICAL: NEVER PLAN TO CREATE src/app/api/ ROUTES FOR CONTRACT INTERACTIONS
- 🚨 CRITICAL: USE wagmi hooks (useReadContract, useWriteContract) DIRECTLY IN COMPONENTS
- Target specific sections with detailed descriptions:
  * "imports" - what imports to add/modify
  * "tab-content" - which tab content to modify and how
  * "function" - what functions to add/modify
  * "component" - what UI components to add
  * "state" - what state management to add
- Describe implementation requirements without writing actual code
- Include dependencies and contract interactions where relevant
- Ensure all required files are covered with detailed change descriptions
- 🚨 For Web3 apps (isWeb3: true): Use ONLY existing templates in contracts/src/
  * ERC20Template.sol, ERC721Template.sol, EscrowTemplate.sol
  * DO NOT plan new contract logic - templates already have all needed functions
  * Frontend should integrate with template functions (mint, transfer, etc.)
  * NEVER create or modify hardhat.config.js/ts in root - it stays in contracts/ subdirectory
  * DO NOT move contract config files to root directory - they must stay in contracts/
- Provide implementation notes for Stage 3 guidance
- Return valid JSON only
- Every patch must have a valid changes array with descriptions
- NO ACTUAL CODE, NO EXPLANATIONS, ONLY PLANNING JSON

REMEMBER: Return ONLY the JSON object above surrounded by __START_JSON__ and __END_JSON__ markers. No other text, no explanations, no markdown formatting.
`;
  }
}

// ========================================================================
// MODULAR RULE FUNCTIONS - DRY PRINCIPLE
// ========================================================================

function getCoreGenerationRules(): string {
  return `
CODE GENERATION CORE RULES:
- Mobile-first design (~375px width) with tab-based layout
- Use useUser hook: const { username, fid, isMiniApp, isLoading } = useUser()
- Use Tabs component from @/components/ui/Tabs for navigation
- Follow patch plan fields exactly (purpose, description, location, dependencies)
- Include all required imports and implement contract interactions when specified
- Prefer neutral colors with subtle accents, ensure good contrast and accessibility
- For Web3 apps: Modify wagmi.ts to import CHAIN from contractConfig. For non-Web3 apps: Do not modify wagmi.ts
- Do not edit package.json unless absolutely necessary
`;
}

function getClientDirectiveRules(): string {
  return `
CLIENT DIRECTIVE (CRITICAL - BUILD FAILS IF MISSING):
🚨 MANDATORY: Every React component file MUST start with 'use client'; directive as the FIRST line
Pattern: 'use client'; (exactly this format with semicolon)
Required in ALL files with: React hooks, event handlers, or interactive JSX
`;
}

function getWeb3AuthRules(): string {
  return `
=== WEB3 AUTHENTICATION (Farcaster + Wallet) ===
- Import ConnectWallet: import { ConnectWallet } from '@/components/wallet/ConnectWallet';
- Import useAccount: import { useAccount } from 'wagmi';
- Use useUser: const { isMiniApp, username, isLoading } = useUser();
- Use useAccount: const { address } = useAccount();
- Show loading state: if (isLoading) return <div>Loading...</div>;

🚨 CRITICAL: APP MUST WORK IN BOTH ENVIRONMENTS
Farcaster mode: Authenticated via Farcaster (isMiniApp === true)
Browser mode: Must connect wallet for blockchain interactions (address !== null)

CORRECT PATTERN:
{isMiniApp || address ? (
  <main><!-- Full app functionality --></main>
) : (
  <ConnectWallet />
)}

REASONING: Web3 apps require wallet connection in browser for blockchain interactions
`;
}

function getNonWeb3AuthRules(): string {
  return `
=== NON-WEB3 AUTHENTICATION (Farcaster + Browser) ===
- DO NOT import ConnectWallet (not needed - no blockchain)
- DO NOT import wagmi hooks (useAccount, useConnect, etc.)
- Use useUser: const { isMiniApp, username, isLoading } = useUser();
- Show loading state: if (isLoading) return <div>Loading...</div>;

🚨 CRITICAL: APP MUST WORK IN BOTH ENVIRONMENTS
Farcaster mode: Authenticated via Farcaster (isMiniApp === true)
Browser mode: Works directly, no wallet needed (localStorage-based)

CORRECT PATTERN FOR BROWSER:
Option 1 - Anonymous mode (best for most apps):
{isMiniApp ? (
  <main><!-- Show with Farcaster username --></main>
) : (
  <main><!-- Show with generic/anonymous experience --></main>
)}

Option 2 - Simple name input (for personalized apps):
const [guestName, setGuestName] = useLocalStorage('userName', '');

{isMiniApp ? (
  <main>Welcome @{username}</main>
) : !guestName ? (
  <div>
    <input
      placeholder="Enter your name"
      value={guestName}
      onChange={(e) => setGuestName(e.target.value)}
    />
  </div>
) : (
  <main>Welcome {guestName}</main>
)}

REASONING: Non-web3 apps work in browser without wallet (localStorage for data)
`;
}

function getMockDataRules(): string {
  return `
🚨 NO MOCK/FAKE DATA - REAL FUNCTIONALITY ONLY:

FORBIDDEN:
❌ Hardcoded user arrays with fake data
❌ Mock leaderboard/score data
❌ Placeholder content or lorem ipsum
❌ Pre-populated lists with fake entries

REQUIRED:
✅ Use REAL authentication from useAccount() or useUser()
✅ Store data based on storageType (localStorage or blockchain)
✅ Show EMPTY STATES when no data exists
✅ Implement REAL data persistence and retrieval
`;
}

function getEslintRules(): string {
  return `
ESLINT COMPLIANCE (CRITICAL):
- Remove unused variables/imports
- Include all useEffect dependencies
- Use useCallback for functions in useEffect deps
- Use const instead of let when never reassigned
- Escape JSX entities: &apos; &quot; &amp;
- NEVER call React hooks inside callbacks/loops/conditions
- Include imports for all used hooks/components/functions
`;
}

function getLocalStorageRules(): string {
  return `
=== LOCALSTORAGE PATTERN (NON-WEB3 APPS) ===

Create useLocalStorage hook in src/hooks/useLocalStorage.ts:
---
'use client';
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) setStoredValue(JSON.parse(item));
    } catch (error) {
      logger.error('Error loading from localStorage:', error);
    }
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      logger.error('Error saving to localStorage:', error);
    }
  };

  return [storedValue, setValue];
}
---

Usage: const [data, setData] = useLocalStorage<DataType[]>('key', []);
Always show empty states when data.length === 0
`;
}

function getWeb3Rules(): string {
  return `
=== SMART CONTRACT PATTERN (WEB3 APPS) ===

🚨 CONTRACT TEMPLATES:
Use ONLY existing templates from contracts/src/:
- ERC20Template.sol (tokens, rewards, airdrops)
- ERC721Template.sol (NFTs, collectibles, tickets)
- EscrowTemplate.sol (payments, marketplaces)

NEVER write new .sol files. Reference template functions in frontend code.
Templates have all needed functions: mint, transfer, balanceOf, etc.

CHAIN CONFIGURATION:
🚨 contractConfig.ts MUST export CHAIN:
   import { baseSepolia } from 'wagmi/chains';
   export const CHAIN = baseSepolia;
   export const CHAIN_ID = CHAIN.id;
   export const CONTRACT_ADDRESS = '0x...' as \`0x\${string}\`;
   export const CONTRACT_ABI = [...] as const;

🚨 wagmi.ts MUST import CHAIN:
   import { CHAIN } from "./contractConfig";
   export const config = createConfig({
     chains: [CHAIN],
     transports: { [CHAIN.id]: http() },
     connectors: [farcasterMiniApp()],
     ssr: true,
   });

🚨 ALL contract calls MUST use chainId:
   writeContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'fn', args: [...], chainId: CHAIN_ID });
   useReadContract({ address: CONTRACT_ADDRESS, abi: CONTRACT_ABI, functionName: 'fn', chainId: CHAIN_ID, query: { enabled: true } });

CONTRACT ADDRESS SETUP:
✅ Use placeholder initially: const CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000' as \`0x\${string}\`;
✅ Add deployment comment: // TODO: Deploy contract and replace address
✅ Prevent calls to undeployed contracts:
   const { data } = useReadContract({
     address: CONTRACT_ADDRESS,
     abi: ABI,
     functionName: 'fn',
     chainId: CHAIN_ID,
     query: { enabled: CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000' }
   });

WAGMI TYPE REQUIREMENTS:
🚨 Address MUST use: \`0x\${string}\` type assertion
🚨 ABI MUST use: as const assertion
🚨 Query config MUST be wrapped: query: { enabled: condition }

CORRECT PATTERNS:
✅ useReadContract({ address: addr as \`0x\${string}\`, abi: ABI, functionName: 'fn', query: { enabled: !!addr } })
✅ useWriteContract with type assertions

BIGINT:
✅ Use literals: 0n, 1n (not BigInt(0))
✅ Convert for display: Number(value) or value.toString()

ACCESS CONTROL:
- Public minting: Remove onlyOwner or add public mint function
- Owner-only: Keep onlyOwner modifier
- Paid minting: Add payable with require(msg.value >= PRICE)

ERC721 APPS:
🚨 ABI MUST include ALL ERC721Enumerable functions (balanceOf, tokenOfOwnerByIndex, tokenURI, totalSupply, etc.)
🚨 "My NFTs" tab MUST display owned NFTs using available ABI functions, not placeholder text

DEPLOYMENT SCRIPT (contracts/scripts/deploy.js):

🚨 CRITICAL: DEPLOYMENT SCRIPTS MUST WRITE deployment-info.json
Every custom deploy.js MUST include this at the end:

  const fs = require('fs');
  const deploymentInfo = {
    YourContract: await yourContract.getAddress(),
    deployer: deployer.address,
    network: 'baseSepolia',
    chainId: 84532,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync('./deployment-info.json', JSON.stringify(deploymentInfo, null, 2));
  console.log("📄 Deployment info saved to deployment-info.json");

This file is REQUIRED for the system to extract contract addresses!

🚨 CRITICAL: DEPLOYMENT SCRIPTS SHOULD ONLY DEPLOY CONTRACTS
❌ DO NOT call contract methods in deploy.js (e.g., contract.addFunds(), contract.mint(), etc.)
❌ DO NOT send ETH to contracts during deployment
❌ DO NOT initialize contract state beyond constructor parameters
✅ ONLY deploy contracts and log their addresses
✅ Contract method calls should happen in the frontend, not deploy script

WRONG - This will fail:
  const puzzle = await SudokuPuzzle.deploy();
  await puzzle.waitForDeployment();
  await puzzle.addFunds({ value: ethers.parseEther("0.01") }); // ❌ NO!

CORRECT:
  const puzzle = await SudokuPuzzle.deploy();
  await puzzle.waitForDeployment();
  logger.log("✅ SudokuPuzzle:", await puzzle.getAddress()); // ✅ YES!
  // Let frontend call addFunds() when needed

🚨 MULTIPLE CONTRACTS: Add 3-second delay between deployments to prevent nonce conflicts
Example:
  await contract1.waitForDeployment();
  logger.log("✅ Contract1:", await contract1.getAddress());

  // Delay before next deployment
  await new Promise(resolve => setTimeout(resolve, 3000));

  const Contract2 = await ethers.getContractFactory("Contract2");
  const contract2 = await Contract2.deploy();
  await contract2.waitForDeployment();

❌ Back-to-back deployments cause "replacement transaction underpriced" error
`;
}

function getJsonFormattingRules(): string {
  return `
JSON FORMATTING:
- Escape quotes as \\", newlines as \\n, backslashes as \\\\
- Example: "content": "'use client';\\n\\nimport { useState } from \\"react\\";\\n"
🚨 For .json files: Use SAME escaping as .ts/.tsx files (NOT double-escaped)
`;
}

function getDiffGenerationRules(): string {
  return `
DIFF-BASED APPROACH:
- Use provided diffHunks and unifiedDiff from patch plan
- Apply surgical changes using unified diff format
- Preserve existing code structure, modify only necessary lines
- For new files, generate complete content
- Validate diffs are minimal and precise

🚨 SMALL HUNKS RULE - CRITICAL FOR SUCCESS:
- Each hunk MUST be SMALL: maximum 10 total lines (including context)
- Include ONLY 2-3 context lines before and after the actual changes
- If multiple changes are needed in one function, create MULTIPLE SMALL hunks
- NEVER create hunks larger than 10 lines - they will fail to apply
- EXAMPLE: To change 3 lines in a 50-line function, create 3 separate small hunks, not 1 large hunk

LINE NUMBER CALCULATION FROM NUMBERED FILES:
The files are provided with line numbers in format: "123|actual content here"

IMPORTANT: When generating diff context lines:
1. Use the NUMBER (before |) to determine line position for @@ header
2. Use the CONTENT (after |) as the actual context line text
3. DO NOT include the line number prefix in your diff

EXAMPLE - Given numbered file:
172|export function playerHit(gameState: GameState, playerId: number): GameState {
173|  const newState = { ...gameState };
174|  const player = newState.players[playerId];

Your diff hunk should be:
@@ -172,3 +172,3 @@
 export function playerHit(gameState: GameState, playerId: number): GameState {
-  const newState = { ...gameState };
+  const newState = JSON.parse(JSON.stringify(gameState));
   const player = newState.players[playerId];

NOTICE: Context lines are the EXACT text after the | symbol, without the line numbers.

🚨 CRITICAL: ARRAY/OBJECT LITERAL BOUNDARIES:
- NEVER insert code inside array literals: const arr = [ /* ❌ NO CODE HERE */ ]
- NEVER insert code inside object literals: const obj = { /* ❌ NO CODE HERE */ }
- NEVER insert code between array/object opening and first element
- ✅ Insert BEFORE the declaration: logger.log('before'); const arr = [1, 2, 3];
- ✅ Insert AFTER the declaration: const arr = [1, 2, 3]; logger.log('after');
- ❌ WRONG: const arr = [\n  logger.log();\n  1, 2, 3\n];

EXAMPLE - Adding logging to array initialization:
❌ WRONG:
  const data = puzzle || [
    logger.log('test');
    [1, 2, 3],
    [4, 5, 6]
  ];

✅ CORRECT:
  logger.log('test');
  const data = puzzle || [
    [1, 2, 3],
    [4, 5, 6]
  ];

DIFF VALIDATION:
- Every hunk MUST start and end with context lines (space prefix)
- Line counts MUST match actual number of lines in hunk
- Context lines MUST be EXACT copies of file content (text after | in numbered lines)
- NEVER use 0 for oldLines or newLines
- NEVER add extra blank lines that don't exist in the numbered content
- Check that insertions don't break multi-line expressions
- Verify closing brackets/braces align correctly after changes

CRITICAL: 'use client' DIRECTIVE IN DIFFS:
- The 'use client' directive is ALREADY in the original file
- DO NOT include it in your diff - it's already there
- Account for it when calculating line numbers
`;
}

function getOutputFormatRules(isInitialGeneration: boolean): string {
  if (isInitialGeneration) {
    return `
OUTPUT FORMAT - INITIAL GENERATION:
Generate complete files as JSON array:
__START_JSON__
[{"filename": "path/to/file", "content": "complete file content"}]
__END_JSON__

CRITICAL: Use ONLY the fields shown above. Do NOT include:
- "changes", "dependencies", "implementationNotes", "intentSpec", or other planning fields
- These are Stage 2 fields and will cause parsing errors in Stage 3
`;
  } else {
    return `
OUTPUT FORMAT - FOLLOW-UP CHANGES:
Generate diffs/files as JSON array with EXACTLY these fields:
__START_JSON__
[
  {"filename": "path", "operation": "modify", "unifiedDiff": "@@ ... @@", "diffHunks": [...]},
  {"filename": "new/path", "operation": "create", "content": "complete content"}
]
__END_JSON__

CRITICAL: Use ONLY the fields shown above. Do NOT include:
- "changes", "dependencies", "implementationNotes", "intentSpec", or other planning fields
- These are Stage 2 fields and will cause parsing errors in Stage 3
- Each object should have ONLY: filename, operation, and either (unifiedDiff + diffHunks) OR content
`;
  }
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
  currentFiles: { filename: string; content: string }[],
  isInitialGeneration: boolean = false,
  appType: 'farcaster' | 'web3' = 'farcaster'
): string {
  const context = getContextForAppType(appType);
  
  const web3Warning = appType === 'web3' ? `
${'='.repeat(80)}
🚨🚨🚨 CRITICAL: THIS IS A WEB3 WEB APP - NOT A FARCASTER MINI APP! 🚨🚨🚨
${'='.repeat(80)}

WHEN GENERATING CODE, THE useUser HOOK RETURNS **ONLY** WALLET DATA:
  ✅ CORRECT: const { address, isConnected, isConnecting, balance, ensName } = useUser();
  ❌ WRONG: const { username, fid, isMiniApp, isLoading } = useUser(); // THESE DON'T EXIST!

⚠️ CRITICAL: LOADING STATE PROPERTY NAME IS DIFFERENT!
  - userData.isLoading ❌ DOES NOT EXIST → Use userData.isConnecting ✅
  - if (userData.isLoading) ❌ WRONG → if (userData.isConnecting) ✅

NEVER WRITE CODE THAT ACCESSES THESE PROPERTIES:
  - userData.isLoading ❌ FORBIDDEN → Use isConnecting ✅
  - userData.username ❌ FORBIDDEN → Use address ✅
  - userData.fid ❌ FORBIDDEN
  - userData.displayName ❌ FORBIDDEN → Use ensName ✅
  - userData.pfpUrl ❌ FORBIDDEN
  - userData.isMiniApp ❌ FORBIDDEN

IF YOU GENERATE CODE WITH ANY OF THESE PROPERTIES, THE BUILD WILL FAIL!

CORRECT LOADING CHECK FOR WEB3:
  const userData = useUser();
  if (userData.isConnecting) { return <div>Connecting...</div>; }
  if (!userData.isConnected) { return <ConnectWallet />; }
  // Now use userData.address, userData.balance, etc.

${'='.repeat(80)}
` : '';
  
  // Build modular prompt based on intent
  const storageRules = intentSpec.storageType === 'localStorage'
    ? getLocalStorageRules()
    : intentSpec.storageType === 'blockchain'
    ? getWeb3Rules()
    : '';

  // Choose auth rules based on web3 requirement
  const authRules = intentSpec.isWeb3
    ? getWeb3AuthRules()
    : getNonWeb3AuthRules();

  if (isInitialGeneration) {
    return `${web3Warning}
ROLE: Code Generator for ${appType === 'web3' ? 'Web3 Web App' : 'Farcaster Miniapp'} - Initial Generation

INTENT: ${JSON.stringify(intentSpec, null, 2)}

DETAILED PATCH PLAN: ${JSON.stringify(patchPlan, null, 2)}

CURRENT FILES (Boilerplate):
${currentFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

TASK: Generate complete file contents based on the detailed patch plan for initial project generation

${getCoreGenerationRules()}
${getClientDirectiveRules()}
${authRules}
${getMockDataRules()}
${storageRules}
${getEslintRules()}
${getJsonFormattingRules()}
${getOutputFormatRules(true)}

REMEMBER: Return ONLY the JSON array above surrounded by __START_JSON__ and __END_JSON__ markers. No other text, no explanations, no markdown formatting.
`;
  } else {
    // Follow-up changes - use diff-based approach
    return `${web3Warning}
ROLE: Code Generator for ${appType === 'web3' ? 'Web3 Web App' : 'Farcaster Miniapp'} - Follow-up Changes

INTENT: ${JSON.stringify(intentSpec, null, 2)}

DETAILED PATCH PLAN: ${JSON.stringify(patchPlan, null, 2)}

CURRENT FILES (with line numbers for accurate diff calculation):
${currentFiles.map((f) => {
  const lines = f.content.split('\n');
  const numberedContent = lines.map((line, index) => `${(index + 1).toString().padStart(3, ' ')}|${line}`).join('\n');
  return `---${f.filename}---\n${numberedContent}`;
}).join("\n\n")}

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

TASK: Generate unified diff patches based on the detailed patch plan. Apply surgical changes using the provided diff hunks rather than rewriting entire files. For new files, generate complete content. For modifications, output only the unified diff patches.

🚨 CRITICAL: FILE CLASSIFICATION AND MANDATORY REQUIREMENTS 🚨

EXISTING FILES (MUST use diff format):
${currentFiles.map(f => `  - ${f.filename} → EXISTING FILE (operation: "modify", unifiedDiff required, NO content field)`).join('\n')}

FOR EXISTING FILES ABOVE:
✅ REQUIRED: operation: "modify"
✅ REQUIRED: unifiedDiff field with complete unified diff
✅ REQUIRED: diffHunks array with proper hunk objects
❌ FORBIDDEN: content field (do not regenerate entire file)
❌ FORBIDDEN: operation: "create" (these files already exist)

FOR NEW FILES ONLY (not in list above):
✅ REQUIRED: operation: "create"
✅ REQUIRED: content field with complete file content
❌ FORBIDDEN: unifiedDiff or diffHunks (use content instead)

🚨 VALIDATION RULES:
BEFORE outputting each file object, CHECK:
1. Is filename in EXISTING FILES list above?
   - YES → MUST have: operation="modify", unifiedDiff, diffHunks, NO content
   - NO → MUST have: operation="create", content, NO unifiedDiff/diffHunks
2. Any file with operation="create" for an EXISTING FILE will be REJECTED
3. Any file with content field for an EXISTING FILE will be REJECTED
4. Any file with unifiedDiff for a NEW FILE will be REJECTED

EXAMPLE OUTPUT FOR EXISTING FILE (from list above):
{
  "filename": "src/app/page.tsx",
  "operation": "modify",
  "unifiedDiff": "@@ -5,3 +5,6 @@\n import { ConnectWallet } from '@/components/wallet/ConnectWallet';\n import { Tabs } from '@/components/ui/Tabs';\n+import { useState } from 'react';\n+import { useEffect } from 'react';\n import { useUser } from '@/hooks';\n ",
  "diffHunks": [
    {
      "oldStart": 5,
      "oldLines": 3,
      "newStart": 5,
      "newLines": 6,
      "lines": [
        " import { ConnectWallet } from '@/components/wallet/ConnectWallet';",
        " import { Tabs } from '@/components/ui/Tabs';",
        "+import { useState } from 'react';",
        "+import { useEffect } from 'react';",
        " import { useUser } from '@/hooks';",
        " "
      ]
    }
  ]
}

EXAMPLE OUTPUT FOR NEW FILE (NOT in existing files list):
{
  "filename": "src/hooks/useNewFeature.ts",
  "operation": "create",
  "content": "'use client';\n\nimport { useState } from 'react';\n\nexport function useNewFeature() {\n  const [state, setState] = useState(false);\n  return { state, setState };\n}"
}

❌ WRONG OUTPUT (will be rejected):
{
  "filename": "src/app/page.tsx",  // This is in EXISTING FILES
  "operation": "create",  // ❌ WRONG - should be "modify"
  "content": "...entire file..."  // ❌ WRONG - should use unifiedDiff
}

${getDiffGenerationRules()}
${getCoreGenerationRules()}
${getClientDirectiveRules()}
${authRules}
${getMockDataRules()}
${storageRules}
${getEslintRules()}
${getJsonFormattingRules()}
${getOutputFormatRules(false)}

REMEMBER: Return ONLY the JSON array above surrounded by __START_JSON__ and __END_JSON__ markers. No other text, no explanations, no markdown formatting.
`;
  }
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
  errors: string[],
  isInitialGeneration: boolean = false,
  appType: 'farcaster' | 'web3' = 'farcaster'
): string {
  const context = getContextForAppType(appType);
  
  const web3Warning = appType === 'web3' ? `
${'='.repeat(80)}
🚨🚨🚨 CRITICAL: FIXING ERRORS IN A WEB3 WEB APP - NOT FARCASTER! 🚨🚨🚨
${'='.repeat(80)}

IF THE ERROR MENTIONS: "Property 'username', 'fid', 'isMiniApp' does not exist"
THIS IS BECAUSE THOSE PROPERTIES DON'T EXIST IN WEB3 useUser HOOK!

THE useUser HOOK IN THIS PROJECT RETURNS **ONLY** WALLET DATA:
  ✅ AVAILABLE: address, isConnected, balance, ensName, chainId
  ❌ FORBIDDEN: username, fid, displayName, pfpUrl, isMiniApp

TO FIX: REMOVE ALL REFERENCES TO FARCASTER PROPERTIES!

${'='.repeat(80)}
` : '';
  
  return `${web3Warning}
ROLE: Code Validator for Next.js 15 + TypeScript + React

ERRORS FOUND:
${errors.join("\n")}

FILES TO REGENERATE:
${generatedFiles.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

TASK: Fix critical errors that would prevent the project from running. ${isInitialGeneration ? 'Generate complete corrected files for initial project generation.' : 'Generate unified diff patches for surgical fixes rather than rewriting entire files. PRESERVE the existing implementation from Stage 3 - only fix the specific validation errors mentioned.'}

BOILERPLATE CONTEXT:
${JSON.stringify(context, null, 2)}

CRITICAL: Return ONLY a JSON array. Surround the JSON with EXACT markers:
__START_JSON__
{ ... your JSON ... }
__END_JSON__
Nothing else before/after the markers. Do not include any explanatory text, comments, or additional content outside the JSON markers.

OUTPUT FORMAT:
${isInitialGeneration ? `
__START_JSON__
[
  {
    "filename": "EXACT_SAME_FILENAME",
    "content": "Complete corrected file content with all fixes applied"
  }
]
__END_JSON__
` : `
__START_JSON__
[
  {
    "filename": "EXACT_SAME_FILENAME",
    "operation": "modify",
    "unifiedDiff": "@@ -1,3 +1,6 @@\n import { ConnectWallet } from '@/components/wallet/ConnectWallet';\n import { Tabs } from '@/components/ui/Tabs';\n+import { useReadContract } from 'wagmi';\n+import { useAccount } from 'wagmi';\n import { useUser } from '@/hooks';\n ",
    "diffHunks": [
      {
        "oldStart": 1,
        "oldLines": 3,
        "newStart": 1,
        "newLines": 6,
        "lines": [" import { ConnectWallet } from '@/components/wallet/ConnectWallet';", " import { Tabs } from '@/components/ui/Tabs';", "+import { useReadContract } from 'wagmi';", "+import { useAccount } from 'wagmi';", " import { useUser } from '@/hooks';", " "]
      }
    ]
  }
]
__END_JSON__
`}

CRITICAL FIXES ONLY - PRESERVE EXISTING IMPLEMENTATIONS:

🚨 CRITICAL: DO NOT rewrite entire components or functions
🚨 CRITICAL: Only fix the specific validation errors mentioned above
🚨 CRITICAL: Preserve all existing functionality and UI implementations
🚨 CRITICAL: If Stage 3 had a sophisticated implementation, keep it - don't simplify

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

4. ESLINT ERRORS:
   - Fix unused variables (@typescript-eslint/no-unused-vars)
   - Fix unused imports (@typescript-eslint/no-unused-vars)
   - Fix missing useEffect dependencies (react-hooks/exhaustive-deps)
   - Fix React hooks rules violations (react-hooks/rules-of-hooks)
   - Fix unescaped entities in JSX (react/no-unescaped-entities)
   - Fix explicit any types (@typescript-eslint/no-explicit-any) - replace with proper types
   - Remove any unused destructured variables
   - Remove any unused imported modules
   - Replace Array.from() with for loops when calling hooks
   - Escape apostrophes (&apos;), quotes (&quot;), and ampersands (&amp;) in JSX
   - Fix duplicate 'use client' directives - keep only one at the very top

PRESERVATION RULES:
- If the original file had a Button component with Check icon, keep it
- If the original file had sophisticated styling, keep it
- If the original file had proper accessibility attributes, keep them
- Only add 'use client' directive if missing
- Only fix syntax errors, don't change the implementation approach

EXAMPLE - WHAT NOT TO DO:
❌ WRONG: Replace sophisticated Button+Check implementation with basic HTML checkbox
❌ WRONG: Simplify complex conditional styling to basic classes
❌ WRONG: Remove accessibility attributes or proper event handlers

EXAMPLE - WHAT TO DO:
✅ CORRECT: Add 'use client'; at the top if missing
✅ CORRECT: Fix unescaped quotes: 'text' → &apos;text&apos;
✅ CORRECT: Fix missing semicolons or brackets
✅ CORRECT: Keep all existing UI implementations exactly as they are

RULES:
- Return EXACTLY the same filenames provided
- Generate surgical diff patches for critical fixes
- DO NOT create new files beyond those provided
- DO NOT add markdown formatting
- Return ONLY the JSON array
- NO EXPLANATIONS, NO TEXT, NO CODE BLOCKS

CRITICAL: Return ONLY the JSON array above surrounded by __START_JSON__ and __END_JSON__ markers. No other text, comments, or explanatory content outside the markers.
`;
}

// Helper function to get boilerplate context
// Helper to get the right context based on app type
function getContextForAppType(appType: 'farcaster' | 'web3' = 'farcaster') {
  return appType === 'web3' ? WEB3_BOILERPLATE_CONTEXT : FARCASTER_BOILERPLATE_CONTEXT;
}

export function getBoilerplateContext(appType: 'farcaster' | 'web3' = 'farcaster') {
  const context = getContextForAppType(appType);
  return {
    structure: appType === 'web3' ? context.structure : BOILERPLATE_STRUCTURE,
    context,
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
  files: { filename: string; content?: string; unifiedDiff?: string; operation?: string }[]
): {
  isValid: boolean;
  missingFiles: string[];
} {
  // Only validate that we have at least one file and it's not empty
  if (files.length === 0) {
    logger.warn("No files generated");
    return {
      isValid: false,
      missingFiles: ["No files generated"],
    };
  }

  // Check for empty files - handle both content and diff-based files
  const emptyFiles = files.filter((file) => {
    if (file.operation === 'create') {
      return !file.content || file.content.trim() === "";
    } else if (file.operation === 'modify') {
      return !file.unifiedDiff || file.unifiedDiff.trim() === "";
    }
    // Fallback to content check for backward compatibility
    return !file.content || file.content.trim() === "";
  });
  
  if (emptyFiles.length > 0) {
    logger.warn(
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
  files: { filename: string; content?: string; unifiedDiff?: string; operation?: string }[],
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
    // Get content to analyze - prefer content for create operations, unifiedDiff for modify
    const contentToAnalyze = file.operation === 'create' ? file.content : 
                            file.operation === 'modify' ? file.unifiedDiff : 
                            file.content || file.unifiedDiff;
    
    if (!contentToAnalyze) return; // Skip if no content to analyze
    
    importPatterns.forEach((pattern) => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(contentToAnalyze)) !== null) {
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
    logger.warn("Missing imported files:", missingImports);
  }

  return {
    hasAllImports: missingImports.length === 0,
    missingImports,
  };
}

// ========================================================================
// FILE FILTERING UTILITIES
// ========================================================================

/**
 * Filter boilerplate files based on web3 requirement
 * Excludes contracts/ folder and wallet components for non-web3 apps to save tokens and improve focus
 *
 * @param files - Array of files to filter
 * @param isWeb3 - Whether the app requires web3/blockchain functionality
 * @returns Filtered array of files
 */
export function filterFilesByWeb3Requirement(
  files: { filename: string; content: string }[],
  isWeb3: boolean
): { filename: string; content: string }[] {
  if (isWeb3) {
    // Keep all files for web3 apps (including contracts)
    logger.log(`📦 Web3 app detected (isWeb3: true)`);
    logger.log(`📦 Including ALL ${files.length} files (with contracts/)`);
    return files;
  }

  // Filter out contracts folder for non-web3 apps
  const filtered = files.filter(file => {
    const isContractFile = file.filename.startsWith('contracts/');
    return !isContractFile;
  });

  const removed = files.length - filtered.length;
  logger.log(`📦 Non-web3 app detected (isWeb3: false)`);
  logger.log(`📦 Filtered out ${removed} contract files from contracts/`);
  logger.log(`📦 Sending ${filtered.length} files to LLM (contracts excluded)`);
  logger.log(`💰 Token savings: ~${removed * 150} tokens (estimated)`);

  return filtered;
}

/**
 * Filter out LLM-generated config files that shouldn't overwrite boilerplate
 * Protects critical config files from being regenerated by LLM
 *
 * @param files - Array of generated files
 * @returns Filtered array without protected config files
 */
export function filterProtectedConfigFiles(
  files: { filename: string; content?: string; unifiedDiff?: string; operation?: string }[]
): { filename: string; content?: string; unifiedDiff?: string; operation?: string }[] {
  const protectedFiles = [
    'postcss.config.mjs',
    'postcss.config.js',
    'tailwind.config.js',
    'tailwind.config.ts',
    'next.config.ts',
    'next.config.js',
    'next.config.mjs',
    'tsconfig.json',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'hardhat.config.js',          // Block root-level hardhat config
    'hardhat.config.ts',          // Block root-level hardhat config
    'contracts/hardhat.config.js',
    'contracts/hardhat.config.ts',
    'contracts/package.json',
    'contracts/package-lock.json'
  ];

  const filtered = files.filter(file => {
    const isProtected = protectedFiles.includes(file.filename);
    if (isProtected) {
      logger.log(`🛡️ Filtering out protected config file: ${file.filename} (keeping boilerplate version)`);
    }
    return !isProtected;
  });

  const removed = files.length - filtered.length;
  if (removed > 0) {
    logger.log(`🛡️ Protected ${removed} config files from LLM overwriting`);
  }

  return filtered;
}

/**
 * Validate that no new contract files are being generated
 * Only existing templates should be used
 *
 * @param files - Array of generated files
 * @returns true if validation passes, false otherwise
 */
export function validateNoNewContracts(
  files: { filename: string; content?: string; operation?: string }[]
): { isValid: boolean; invalidFiles: string[] } {
  const invalidFiles: string[] = [];

  for (const file of files) {
    // Check if it's a .sol file
    if (file.filename.endsWith('.sol')) {
      // Allow only template files
      const isTemplate = file.filename.includes('Template.sol');

      if (!isTemplate && file.operation === 'create') {
        logger.error(`❌ Attempted to create new contract: ${file.filename}`);
        logger.error(`❌ Only template-based contracts allowed (ERC20Template.sol, ERC721Template.sol, EscrowTemplate.sol)`);
        invalidFiles.push(file.filename);
      }
    }
  }

  return {
    isValid: invalidFiles.length === 0,
    invalidFiles
  };
}

// ========================================================================
// SHARED PIPELINE STAGES (Stage 1 & 2)
// ========================================================================

/**
 * Stage 1: Intent Parser - Shared by both pipelines
 * Parses user request into structured specification
 */
async function executeStage1IntentParser(
  userPrompt: string,
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<IntentSpec> {
  logger.log("\n" + "=".repeat(50));
  logger.log("📋 STAGE 1: Intent Parser");
  logger.log("=".repeat(50));

  const intentPrompt = `USER REQUEST: ${userPrompt}`;
  logger.log("📤 Sending to LLM (Stage 1):");
  logger.log(
    "System Prompt Length:",
    getStage1IntentParserPrompt(appType).length,
    "chars"
  );
  logger.log("User Prompt:", intentPrompt);

  const startTime1 = Date.now();
  const intentResponse = await callLLM(
    getStage1IntentParserPrompt(appType),
    intentPrompt,
    "Stage 1: Intent Parser",
    "STAGE_1_INTENT_PARSER"
  );
  const endTime1 = Date.now();
  
  // Log Stage 1 response for debugging
  if (projectId) {
    logStageResponse(projectId, 'stage1-intent-parser', intentResponse, {
      systemPromptLength: getStage1IntentParserPrompt(appType).length,
      userPromptLength: intentPrompt.length,
      responseTime: endTime1 - startTime1
    });
  }

  logger.log("📥 Received from LLM (Stage 1):");
  logger.log("Response Length:", intentResponse.length, "chars");
  logger.log("Response Time:", endTime1 - startTime1, "ms");

  let intentSpec: IntentSpec;
  try {
    intentSpec = JSON.parse(intentResponse);
  } catch (error) {
    logger.error("❌ Failed to parse Stage 1 response as JSON:");
    logger.error("Raw response:", intentResponse);
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

  logger.log("✅ Stage 1 complete - Parsed Intent:");
  logger.log("  Feature:", intentSpec.feature);
  logger.log("  Requirements:", intentSpec.requirements.length);
  logger.log("  Target Files:", intentSpec.targetFiles.length);
  logger.log("  Dependencies:", intentSpec.dependencies.length);
  logger.log("  Needs Changes:", intentSpec.needsChanges);
  logger.log("  Reason:", intentSpec.reason);

  return intentSpec;
}

/**
 * Stage 2: Patch Planner - Shared by both pipelines
 * Creates detailed patch plan based on intent
 */
async function executeStage2PatchPlanner(
  userPrompt: string,
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  isInitialGeneration: boolean,
  projectId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<PatchPlan> {
  logger.log("\n" + "=".repeat(50));
  logger.log("📝 STAGE 2: Patch Planner");
  logger.log("=".repeat(50));

  // Optimize: Only include target files from intentSpec to reduce prompt size
  const relevantFiles = !isInitialGeneration && intentSpec.targetFiles.length > 0
    ? currentFiles.filter(f => 
        intentSpec.targetFiles.some(targetFile => 
          f.filename.includes(targetFile) || targetFile.includes(f.filename)
        )
      )
    : currentFiles;
  
  logger.log(`📊 Files included: ${relevantFiles.length} of ${currentFiles.length} total`);
  if (relevantFiles.length < currentFiles.length) {
    logger.log(`   Filtered to target files: ${intentSpec.targetFiles.join(', ')}`);
  }

  const patchPrompt = `USER REQUEST: ${userPrompt}`;
  logger.log("📤 Sending to LLM (Stage 2):");
  logger.log(
    "System Prompt Length:",
    getStage2PatchPlannerPrompt(intentSpec, relevantFiles, isInitialGeneration, appType).length,
    "chars"
  );
  logger.log("User Prompt:", patchPrompt);
  logger.log("Intent Spec:", JSON.stringify(intentSpec, null, 2));

  const startTime2 = Date.now();
  const patchResponse = await callLLM(
    getStage2PatchPlannerPrompt(intentSpec, relevantFiles, isInitialGeneration, appType),
    patchPrompt,
    "Stage 2: Patch Planner",
    "STAGE_2_PATCH_PLANNER"
  );
  const endTime2 = Date.now();
  
  // Log Stage 2 response for debugging
  if (projectId) {
    logStageResponse(projectId, 'stage2-patch-planner', patchResponse, {
      systemPromptLength: getStage2PatchPlannerPrompt(intentSpec, relevantFiles, isInitialGeneration, appType).length,
      userPromptLength: patchPrompt.length,
      responseTime: endTime2 - startTime2,
      intentSpec: intentSpec
    });
  }

  logger.log("📥 Received from LLM (Stage 2):");
  logger.log("Response Length:", patchResponse.length, "chars");
  logger.log("Response Time:", endTime2 - startTime2, "ms");
  logger.log("Raw Response:", patchResponse.substring(0, 500) + "...");

  const patchPlan: PatchPlan = parseStage2PatchResponse(patchResponse);

  // Check for potential truncation
  const isPotentiallyTruncated = isResponseTruncated(patchResponse);
  
  if (isPotentiallyTruncated) {
    logger.warn("⚠️ Stage 2 response appears to be truncated. Retry logic is handled in callClaudeWithLogging.");
    logger.warn("Response ends with:", patchResponse.slice(-100));
  }

  // Validate patch plan structure
  if (!patchPlan.patches || !Array.isArray(patchPlan.patches)) {
    throw new Error(
      "Invalid patch plan: patches array is missing or not an array"
    );
  }

  // Analyze patch plan
  let totalPatches = 0;
  let createPatches = 0;
  let modifyPatches = 0;
  let deletePatches = 0;

  patchPlan.patches.forEach((patch, index) => {
    // Validate each patch structure
    if (!patch || typeof patch !== "object") {
      logger.warn(`⚠️ Invalid patch ${index + 1}: patch is not an object`);
      return;
    }

    if (!patch.filename || typeof patch.filename !== "string") {
      logger.warn(
        `⚠️ Invalid patch ${index + 1}: filename is missing or not a string`
      );
      return;
    }

    if (
      !patch.operation ||
      !["create", "modify", "delete"].includes(patch.operation)
    ) {
      logger.warn(
        `⚠️ Invalid patch ${index + 1}: operation is missing or invalid`
      );
      return;
    }

    if (!patch.changes || !Array.isArray(patch.changes)) {
      logger.warn(
        `⚠️ Invalid patch ${
          index + 1
        }: changes array is missing or not an array`
      );
      return;
    }

    totalPatches++;
    if (patch.operation === 'create') createPatches++;
    else if (patch.operation === 'modify') modifyPatches++;
    else if (patch.operation === 'delete') deletePatches++;

    logger.log(
      `  Patch ${index + 1}: ${patch.operation} ${patch.filename} (${
        patch.changes.length
      } changes)`
    );
  });

  logger.log(`\n✅ Stage 2 complete - Generated ${totalPatches} patches`);
  logger.log(`  - Create: ${createPatches}`);
  logger.log(`  - Modify: ${modifyPatches}`);
  logger.log(`  - Delete: ${deletePatches}`);

  return patchPlan;
}

// ========================================================================
// INITIAL GENERATION PIPELINE (Complete Files)
// ========================================================================

/**
 * Pipeline for initial project generation
 * Generates complete file contents from boilerplate
 */
export async function executeInitialGenerationPipeline(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  projectDir?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ files: { filename: string; content: string }[]; intentSpec: IntentSpec }> {
  try {
    logger.log("🚀 Starting INITIAL GENERATION pipeline...");
    logger.log("📝 User Prompt:", userPrompt);
    logger.log("📁 Current Files Count:", currentFiles.length);

    // Stage 1: Intent Parser
    const intentSpec = await executeStage1IntentParser(userPrompt, callLLM, projectId, appType);

    // Check if changes are needed
    if (!intentSpec.needsChanges) {
      logger.log("\n" + "=".repeat(50));
      logger.log("✅ NO CHANGES NEEDED - Using Boilerplate As-Is");
      logger.log("=".repeat(50));
      logger.log("📋 Reason:", intentSpec.reason);
      logger.log("📁 Returning", currentFiles.length, "boilerplate files");
      logger.log("🎉 Pipeline completed early - no modifications needed!");
      return { files: currentFiles, intentSpec };
    }

    // 🎯 Filter files based on web3 requirement (after Stage 1, before Stage 2)
    logger.log("\n" + "=".repeat(50));
    logger.log("🔍 FILTERING FILES BASED ON WEB3 REQUIREMENT");
    logger.log("=".repeat(50));
    const filteredFiles = filterFilesByWeb3Requirement(currentFiles, intentSpec.isWeb3);
    logger.log("✅ File filtering complete");

    // Stage 2: Patch Planner (using filtered files)
    const patchPlan = await executeStage2PatchPlanner(
      userPrompt,
      intentSpec,
      filteredFiles, // ← Using filtered files instead of currentFiles
      callLLM,
      true, // isInitialGeneration = true
      projectId,
      appType
    );

    // Stage 3: Code Generator (Complete Files) - using filtered files
    const generatedFiles = await executeStage3InitialGeneration(
      userPrompt,
      patchPlan,
      intentSpec,
      filteredFiles, // ← Using filtered files instead of currentFiles
      callLLM,
      projectId,
      appType
    );

    // Stage 4: Validator (Complete Files) - using ORIGINAL files for validation context
    // Note: Validator needs full file list to check imports/references correctly
    const validatedFiles = await executeStage4InitialValidation(
      generatedFiles,
      currentFiles, // ← Using original currentFiles for validation context
      callLLM,
      projectId,
      projectDir
    );

    // Filter out protected config files to prevent LLM from overwriting boilerplate
    const finalFiles = filterProtectedConfigFiles(validatedFiles) as { filename: string; content: string }[];

    logger.log("\n" + "=".repeat(50));
    logger.log("🎉 INITIAL GENERATION PIPELINE COMPLETED!");
    logger.log("=".repeat(50));
    logger.log(`📁 Generated ${finalFiles.length} files`);

    return { files: finalFiles, intentSpec };
  } catch (error) {
    logger.error("❌ Initial generation pipeline failed:");
    logger.error("  Error:", error);
    logger.error(
      "  Stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

// ========================================================================
// FOLLOW-UP CHANGES PIPELINE (Diff-Based)
// ========================================================================

/**
 * Pipeline for follow-up changes to existing projects
 * Generates surgical diffs instead of complete files
 */
export async function executeFollowUpPipeline(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  projectDir?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ 
  files: { filename: string; content: string }[]; 
  diffs: FileDiff[];
  intentSpec: IntentSpec;
  validationResult?: { success: boolean; errors: Array<{ file: string; line?: number; column?: number; message: string; severity: string }>; warnings: Array<{ file: string; line?: number; column?: number; message: string; severity: string }>; info?: Array<{ file: string; message: string }> };
}> {
  try {
    logger.log("🚀 Starting FOLLOW-UP CHANGES pipeline...");
    logger.log("📝 User Prompt:", userPrompt);
    logger.log("📁 Current Files Count:", currentFiles.length);

    // Stage 1: Intent Parser
    const intentSpec = await executeStage1IntentParser(userPrompt, callLLM, projectId, appType);

    // Check if changes are needed
    if (!intentSpec.needsChanges) {
      logger.log("\n" + "=".repeat(50));
      logger.log("✅ NO CHANGES NEEDED");
      logger.log("=".repeat(50));
      logger.log("📋 Reason:", intentSpec.reason);
      logger.log("📁 Returning", currentFiles.length, "unchanged files");
      return { files: currentFiles, diffs: [], intentSpec };
    }

    // 🎯 Filter files based on web3 requirement (after Stage 1, before Stage 2)
    logger.log("\n" + "=".repeat(50));
    logger.log("🔍 FILTERING FILES BASED ON WEB3 REQUIREMENT");
    logger.log("=".repeat(50));
    const filteredFiles = filterFilesByWeb3Requirement(currentFiles, intentSpec.isWeb3);
    logger.log("✅ File filtering complete");

    // Stage 2: Patch Planner (with diffs) - using filtered files
    const patchPlan = await executeStage2PatchPlanner(
      userPrompt,
      intentSpec,
      filteredFiles, // ← Using filtered files instead of currentFiles
      callLLM,
      false, // isInitialGeneration = false
      projectId,
      appType
    );

    // Stage 3: Code Generator (Diffs) - using filtered files
    const stage3Result = await executeStage3FollowUpGeneration(
      userPrompt,
      patchPlan,
      intentSpec,
      filteredFiles, // ← Using filtered files instead of currentFiles
      callLLM,
      projectId,
      appType
    );
    const { files: filesWithDiffs, diffs } = stage3Result;

    // Stage 4: Validator (Diffs) - using ORIGINAL files for validation context
    // Note: Validator needs full file list to check imports/references correctly
    const { validatedFiles, validationResult } = await executeStage4FollowUpValidation(
      filesWithDiffs,
      currentFiles, // ← Using original currentFiles for validation context
      callLLM,
      projectId,
      projectDir
    );

    // Filter out protected config files to prevent LLM from overwriting boilerplate
    const finalFiles = filterProtectedConfigFiles(validatedFiles) as { filename: string; content: string }[];

    logger.log("\n" + "=".repeat(50));
    logger.log("🎉 FOLLOW-UP PIPELINE COMPLETED!");
    logger.log("=".repeat(50));
    logger.log(`📁 Generated ${finalFiles.length} files`);
    logger.log(`📝 Applied ${diffs.length} diffs`);
    
    if (validationResult) {
      logger.log(`✅ Validation Success: ${validationResult.success}`);
      logger.log(`❌ Validation Errors: ${validationResult.errors.length}`);
      logger.log(`⚠️  Validation Warnings: ${validationResult.warnings.length}`);
    }

    return { files: finalFiles, diffs, intentSpec, validationResult };
  } catch (error) {
    logger.error("❌ Follow-up pipeline failed:");
    logger.error("  Error:", error);
    logger.error(
      "  Stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
    throw error;
  }
}

// ========================================================================
// STAGE 3 & 4 IMPLEMENTATIONS
// ========================================================================

/**
 * Stage 3: Code Generator for Initial Generation
 * Generates complete file contents
 */
async function executeStage3InitialGeneration(
  userPrompt: string,
  patchPlan: PatchPlan,
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(50));
  logger.log("💻 STAGE 3: Code Generator (Initial Generation)");
  logger.log("=".repeat(50));

  const codePrompt = `USER REQUEST: ${userPrompt}`;
  logger.log("📤 Sending to LLM (Stage 3):");
  logger.log(
    "System Prompt Length:",
    getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, true, appType).length,
    "chars"
  );

  const startTime3 = Date.now();
  const codeResponse = await callLLM(
    getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, true, appType),
    codePrompt,
    "Stage 3: Code Generator",
    "STAGE_3_CODE_GENERATOR"
  );
  const endTime3 = Date.now();
  
  // Log Stage 3 response
  if (projectId) {
    logStageResponse(projectId, 'stage3-code-generator', codeResponse, {
      systemPromptLength: getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, true, appType).length,
      userPromptLength: codePrompt.length,
      responseTime: endTime3 - startTime3,
      patchPlan: patchPlan,
      intentSpec: intentSpec
    });
  }

  logger.log("📥 Received from LLM (Stage 3):");
  logger.log("Response Length:", codeResponse.length, "chars");
  logger.log("Response Time:", endTime3 - startTime3, "ms");

  const generatedFiles = parseStage3CodeResponse(codeResponse);

  // Validate generated files structure
  if (!Array.isArray(generatedFiles)) {
    throw new Error("Stage 3 response is not an array");
  }

  // 🚨 CRITICAL: Validate no new contracts are created (Web3 apps only)
  if (intentSpec.isWeb3) {
    const contractValidation = validateNoNewContracts(generatedFiles);
    if (!contractValidation.isValid) {
      logger.error("\n" + "=".repeat(70));
      logger.error("❌ CONTRACT VALIDATION FAILED - NEW CONTRACTS DETECTED");
      logger.error("=".repeat(70));
      logger.error("Invalid files:", contractValidation.invalidFiles);
      logger.error("\n🚨 ONLY TEMPLATE MODIFICATIONS ALLOWED:");
      logger.error("  ✅ contracts/src/ERC20Template.sol");
      logger.error("  ✅ contracts/src/ERC721Template.sol");
      logger.error("  ✅ contracts/src/EscrowTemplate.sol");
      logger.error("  ❌ Any other .sol files are FORBIDDEN\n");
      
      // 🔄 RETRY: Send back to AI with strict template-only instructions
      logger.log("🔄 Retrying Stage 3 with strict template-only enforcement...\n");
      
      const retryPrompt = `
USER REQUEST: ${userPrompt}

🚨🚨🚨 CRITICAL ERROR - RETRY REQUIRED 🚨🚨🚨

You attempted to create these INVALID contract files:
${contractValidation.invalidFiles.map(f => `  ❌ ${f}`).join('\n')}

THIS IS ABSOLUTELY FORBIDDEN. You MUST use ONLY the existing templates:
  ✅ contracts/src/ERC20Template.sol (for tokens, rewards, points)
  ✅ contracts/src/ERC721Template.sol (for NFTs, collectibles, badges)
  ✅ contracts/src/EscrowTemplate.sol (for payments, escrow)

🚨 YOU CANNOT CREATE NEW .sol FILES
🚨 YOU CAN ONLY MODIFY THE EXISTING TEMPLATE FILES
🚨 RENAME THE CONTRACT CLASS INSIDE THE TEMPLATE IF NEEDED

For example, if you need a "MusicArtistToken":
1. Use ERC20Template.sol or ERC721Template.sol
2. Modify the contract name inside: contract MusicArtistToken is ERC20, ...
3. Keep the filename as ERC20Template.sol or ERC721Template.sol
4. Add any custom functions to the template

Now regenerate the code using ONLY the templates above.`;

      const retryResponse = await callLLM(
        getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, true, appType) + 
        "\n\n🚨 TEMPLATE-ONLY MODE: You previously tried to create invalid contracts. Use ONLY ERC20Template.sol, ERC721Template.sol, or EscrowTemplate.sol",
        retryPrompt,
        "Stage 3: Code Generator (Retry - Template Only)",
        "STAGE_3_CODE_GENERATOR"
      );
      
      const retriedFiles = parseStage3CodeResponse(retryResponse);
      
      // Validate again
      const retryValidation = validateNoNewContracts(retriedFiles);
      if (!retryValidation.isValid) {
        logger.error("\n❌ RETRY FAILED - Still generating invalid contracts:", retryValidation.invalidFiles);
        logger.error("🔧 Filtering out invalid contracts and proceeding...\n");
        
        // Last resort: filter out invalid files
        const filteredFiles = retriedFiles.filter(file => 
          !retryValidation.invalidFiles.includes(file.filename)
        );
        
        const completeFiles: { filename: string; content: string }[] = filteredFiles.map(file => ({
          filename: file.filename,
          content: file.content || ''
        }));
        
        return completeFiles;
      }
      
      logger.log("✅ Retry successful - All contracts are valid templates\n");
      
      // Use the retried files
      const completeFiles: { filename: string; content: string }[] = retriedFiles.map(file => ({
        filename: file.filename,
        content: file.content || ''
      }));
      
      return completeFiles;
    }
  }

  // Convert to simple format for initial generation
  const completeFiles: { filename: string; content: string }[] = generatedFiles.map(file => ({
    filename: file.filename,
    content: file.content || ''
  }));

  logger.log(`✅ Stage 3 complete - Generated ${completeFiles.length} complete files`);
  
  return completeFiles;
}

/**
 * Stage 3: Code Generator for Follow-Up Changes
 * Generates diffs and applies them to existing files
 */
async function executeStage3FollowUpGeneration(
  userPrompt: string,
  patchPlan: PatchPlan,
  intentSpec: IntentSpec,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  appType: 'farcaster' | 'web3' = 'farcaster'
): Promise<{ files: { filename: string; content: string }[]; diffs: FileDiff[] }> {
  logger.log("\n" + "=".repeat(50));
  logger.log("💻 STAGE 3: Code Generator (Follow-Up Changes - Diff-Based)");
  logger.log("=".repeat(50));

  const codePrompt = `USER REQUEST: ${userPrompt}`;
  logger.log("📤 Sending to LLM (Stage 3):");
  logger.log(
    "System Prompt Length:",
    getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, false, appType).length,
    "chars"
  );

  const startTime3 = Date.now();
  const codeResponse = await callLLM(
    getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, false, appType),
    codePrompt,
    "Stage 3: Code Generator",
    "STAGE_3_CODE_GENERATOR"
  );
  const endTime3 = Date.now();
  
  // Log Stage 3 response
  if (projectId) {
    logStageResponse(projectId, 'stage3-code-generator', codeResponse, {
      systemPromptLength: getStage3CodeGeneratorPrompt(patchPlan, intentSpec, currentFiles, false, appType).length,
      userPromptLength: codePrompt.length,
      responseTime: endTime3 - startTime3,
      patchPlan: patchPlan,
      intentSpec: intentSpec
    });
  }

  logger.log("📥 Received from LLM (Stage 3):");
  logger.log("Response Length:", codeResponse.length, "chars");
  logger.log("Response Time:", endTime3 - startTime3, "ms");

  const generatedFiles = parseStage3CodeResponse(codeResponse);

  // 🚨 VALIDATION: Verify LLM is following diff-based requirements
  logger.log('\n' + '='.repeat(50));
  logger.log('🔍 STAGE 3 RESPONSE VALIDATION');
  logger.log('='.repeat(50));
  logger.log(`📊 Total files generated: ${generatedFiles.length}`);
  logger.log(`📊 Files with operation='modify': ${generatedFiles.filter(f => f.operation === 'modify').length}`);
  logger.log(`📊 Files with operation='create': ${generatedFiles.filter(f => f.operation === 'create').length}`);
  logger.log(`📊 Files with unifiedDiff: ${generatedFiles.filter(f => f.unifiedDiff).length}`);
  logger.log(`📊 Files with content: ${generatedFiles.filter(f => f.content).length}`);
  logger.log('');

  // Build existing files set for validation
  const existingFileNames = new Set(currentFiles.map(f => f.filename));
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  // Detailed breakdown by file
  logger.log('📋 File-by-file analysis:');
  generatedFiles.forEach(file => {
    const isExisting = existingFileNames.has(file.filename);
    const hasUnifiedDiff = !!file.unifiedDiff;
    const hasContent = !!file.content;
    const operation = file.operation || 'unknown';

    const status = isExisting ? '🔄 EXISTING' : '🆕 NEW';
    logger.log(`  ${status} ${file.filename}:`);
    logger.log(`    - operation: ${operation}`);
    logger.log(`    - hasUnifiedDiff: ${hasUnifiedDiff}`);
    logger.log(`    - hasContent: ${hasContent}`);

    // Validate existing files MUST use diff format
    if (isExisting) {
      if (operation !== 'modify') {
        const error = `❌ ${file.filename}: EXISTING file has operation='${operation}' (should be 'modify')`;
        validationErrors.push(error);
        logger.log(`    ${error}`);
      }
      if (!hasUnifiedDiff) {
        const error = `❌ ${file.filename}: EXISTING file missing unifiedDiff (required for modifications)`;
        validationErrors.push(error);
        logger.log(`    ${error}`);
      }
      if (hasContent) {
        const warning = `⚠️  ${file.filename}: EXISTING file has content field (should use unifiedDiff only)`;
        validationWarnings.push(warning);
        logger.log(`    ${warning}`);
      }
    } else {
      // Validate new files MUST use content format
      if (operation !== 'create') {
        const error = `❌ ${file.filename}: NEW file has operation='${operation}' (should be 'create')`;
        validationErrors.push(error);
        logger.log(`    ${error}`);
      }
      if (!hasContent) {
        const error = `❌ ${file.filename}: NEW file missing content (required for new files)`;
        validationErrors.push(error);
        logger.log(`    ${error}`);
      }
      if (hasUnifiedDiff) {
        const warning = `⚠️  ${file.filename}: NEW file has unifiedDiff (should use content only)`;
        validationWarnings.push(warning);
        logger.log(`    ${warning}`);
      }
    }
  });

  logger.log('');
  if (validationErrors.length > 0) {
    logger.log('❌ VALIDATION ERRORS:', validationErrors.length);
    validationErrors.forEach(err => logger.log(`  ${err}`));
  }
  if (validationWarnings.length > 0) {
    logger.log('⚠️  VALIDATION WARNINGS:', validationWarnings.length);
    validationWarnings.forEach(warn => logger.log(`  ${warn}`));
  }
  if (validationErrors.length === 0 && validationWarnings.length === 0) {
    logger.log('✅ All files passed validation - LLM followed diff-based requirements correctly!');
  }
  logger.log('='.repeat(50) + '\n');

  // 🚨 AGGRESSIVE FALLBACK: Auto-convert full content to diffs for existing files
  if (validationErrors.length > 0) {
    logger.log('\n' + '='.repeat(50));
    logger.log('🔧 AUTO-CONVERSION: LLM violated diff requirements, forcing conversion...');
    logger.log('='.repeat(50));
    
    let conversionsCount = 0;
    for (const file of generatedFiles) {
      const isExisting = existingFileNames.has(file.filename);
      
      // If existing file has full content instead of diff, convert it
      if (isExisting && file.content && !file.unifiedDiff) {
        logger.log(`🔄 Converting ${file.filename} from full content to diff...`);
        
        const originalFile = currentFiles.find(f => f.filename === file.filename);
        if (originalFile) {
          try {
            const diff = generateDiff(originalFile.content, file.content, file.filename);
            
            // Replace full content with diff
            file.operation = 'modify';
            file.unifiedDiff = diff.unifiedDiff;
            file.diffHunks = diff.hunks;
            delete file.content;
            
            conversionsCount++;
            logger.log(`  ✅ Converted successfully (${diff.hunks.length} hunks)`);
          } catch (error) {
            logger.error(`  ❌ Conversion failed:`, error);
          }
        }
      }
    }
    
    logger.log(`\n🔧 Auto-conversion complete: ${conversionsCount} files converted to diffs`);
    logger.log('='.repeat(50) + '\n');
  }

  // Process files: apply diffs for modifications, use content for new files
  const filesWithDiffs = generatedFiles.filter(file => file.operation === 'modify' && file.unifiedDiff);
  const filesWithContent = generatedFiles.filter(file => file.operation === 'create' && file.content);

  logger.log(`📊 File processing breakdown:`);
  logger.log(`  Files with diffs (will apply): ${filesWithDiffs.length}`);
  logger.log(`  Files with content (will add): ${filesWithContent.length}`);
  
  if (filesWithDiffs.length === 0 && existingFileNames.size > 0) {
    logger.warn('⚠️  WARNING: No diffs to apply despite having existing files!');
    logger.warn('   This means the LLM regenerated entire files instead of creating diffs.');
    logger.warn('   Check the validation errors above to see what went wrong.');
  }

  const processedFiles: { filename: string; content: string }[] = [];

  // Apply diffs to existing files
  if (filesWithDiffs.length > 0) {
    logger.log(`🔄 Applying diffs to ${filesWithDiffs.length} files...`);
    
    const diffs = filesWithDiffs.map(file => {
      const hunks = parseUnifiedDiff(file.unifiedDiff!);
      return {
        filename: file.filename,
        hunks: hunks,
        unifiedDiff: file.unifiedDiff!
      };
    }).filter(diff => diff.hunks.length > 0);

    const filesWithAppliedDiffs = applyDiffsToFiles(currentFiles, diffs);
    processedFiles.push(...filesWithAppliedDiffs);
    logger.log(`✅ Successfully applied diffs to ${filesWithAppliedDiffs.length} files`);
  }

  // Add new files with complete content
  if (filesWithContent.length > 0) {
    logger.log(`📝 Adding ${filesWithContent.length} new files...`);
    filesWithContent.forEach(file => {
      processedFiles.push({
        filename: file.filename,
        content: file.content!
      });
    });
  }

  // Collect the diffs that were applied
  const appliedDiffs: FileDiff[] = [];
  if (filesWithDiffs.length > 0) {
    const diffs = filesWithDiffs.map(file => {
      const hunks = parseUnifiedDiff(file.unifiedDiff!);
      return {
        filename: file.filename,
        hunks: hunks,
        unifiedDiff: file.unifiedDiff!
      };
    }).filter(diff => diff.hunks.length > 0);
    appliedDiffs.push(...diffs);
  }

  logger.log(`✅ Stage 3 complete - Generated ${processedFiles.length} files with ${appliedDiffs.length} diffs`);
  
  return { files: processedFiles, diffs: appliedDiffs };
}

/**
 * Stage 4: Compilation Validator for Initial Generation
 * Validates and fixes complete files using Railway's full compilation validation
 */
async function executeStage4InitialValidation(
  generatedFiles: { filename: string; content: string }[],
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  projectDir?: string
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(50));
  logger.log("🔍 STAGE 4: Compilation Validation (Initial Generation)");
  logger.log("=".repeat(50));
  logger.log(`📊 Input Summary:`);
  logger.log(`  - Generated files: ${generatedFiles.length}`);
  logger.log(`  - Current files: ${currentFiles.length}`);
  logger.log(`  - Project ID: ${projectId || 'None'}`);

  // Skip Railway validation in production (causes 3+ min timeouts + memory failures)
  if (process.env.NODE_ENV === 'production') {
    logger.log("⚠️  Railway validation skipped in production - using local validation only");
    // Jump directly to local validation
  } else {
    // Try Railway validation first (full validation) - development only
    try {
    logger.log("\n🚂 Attempting Railway validation (full compilation)...");
    const railwayClient = createRailwayValidationClient();
    
    // Check if Railway validation is available
    const isRailwayAvailable = await railwayClient.checkHealth();
    if (isRailwayAvailable) {
      logger.log("✅ Railway validation available - using full compilation validation");
      
      const railwayResult = await railwayClient.validateProject(
        projectId || `validation-${Date.now()}`,
        generatedFiles,
        {
          enableTypeScript: true,
          enableSolidity: true,
          enableESLint: true,
          enableBuild: true,
          enableRuntimeChecks: true
        },
        projectDir // Pass the complete project directory
      );

      logger.log("\n📊 Railway Validation Results Summary:");
      logger.log("  ✅ Success:", railwayResult.success);
      logger.log("  ❌ Errors:", railwayResult.errors.length);
      logger.log("  ⚠️  Warnings:", railwayResult.warnings.length);
      logger.log("  ℹ️  Info:", railwayResult.info.length);
      logger.log("  ⏱️  Compilation Time:", railwayResult.compilationTime, "ms");
      logger.log("  📋 Validation Summary:", railwayResult.validationSummary);

      if (railwayResult.success) {
        logger.log("\n🎉 Railway validation successful - files are valid!");
        logger.log(`📁 Returning ${railwayResult.files.length} validated files`);
        return railwayResult.files;
      } else {
        logger.log("\n⚠️ Railway validation found errors - proceeding to error fixing...");
        return await fixRailwayCompilationErrors(railwayResult, callLLM, projectId, true);
      }
    } else {
      logger.log("⚠️ Railway validation not available - falling back to local validation");
    }
  } catch (railwayError) {
    logger.warn("⚠️ Railway validation failed - falling back to local validation:", railwayError);
  }
  }

  // Fallback to local validation (limited in serverless)
  logger.log("\n🔧 Falling back to local CompilationValidator...");
  const validator = new CompilationValidator(process.cwd());
  
  // Convert to the format expected by CompilationValidator
  logger.log("🔄 Converting files for validation...");
  const filesForValidation = generatedFiles.map(file => ({
    filename: file.filename,
    content: file.content,
    operation: 'create' as const
  }));
  logger.log(`  ✅ Converted ${filesForValidation.length} files for validation`);

  logger.log("\n🚀 Starting local compilation validation...");
  const compilationResult = await validator.validateProject(
    filesForValidation,
    currentFiles
  );

  logger.log("\n📊 Local Compilation Results Summary:");
  logger.log("  ✅ Success:", compilationResult.success);
  logger.log("  ❌ Errors:", compilationResult.errors.length);
  logger.log("  ⚠️  Warnings:", compilationResult.warnings.length);
  logger.log("  ℹ️  Info:", compilationResult.info.length);
  logger.log("  ⏱️  Compilation Time:", compilationResult.compilationTime, "ms");
  logger.log("  📋 Validation Summary:", compilationResult.validationSummary);

  if (compilationResult.success) {
    logger.log("\n🎉 Local validation successful - files are valid!");
    logger.log(`📁 Returning ${compilationResult.files.length} validated files`);
    return compilationResult.files;
  }

  logger.log("\n⚠️ Local validation found errors - proceeding to error fixing...");
  return await fixCompilationErrors(compilationResult, callLLM, projectId, true);
}

/**
 * Stage 4: Compilation Validator for Follow-Up Changes
 * Validates and fixes diff-based changes using Railway's full compilation validation
 */
async function executeStage4FollowUpValidation(
  generatedFiles: { filename: string; content: string }[],
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  projectDir?: string
): Promise<{ 
  validatedFiles: { filename: string; content: string }[];
  validationResult: { success: boolean; errors: Array<{ file: string; line?: number; column?: number; message: string; severity: string }>; warnings: Array<{ file: string; line?: number; column?: number; message: string; severity: string }>; info?: Array<{ file: string; message: string }> };
}> {
  logger.log("\n" + "=".repeat(50));
  logger.log("🔍 STAGE 4: Compilation Validation (Follow-Up Changes)");
  logger.log("=".repeat(50));
  logger.log(`📊 Input Summary:`);
  logger.log(`  - Generated files: ${generatedFiles.length}`);
  logger.log(`  - Current files: ${currentFiles.length}`);
  logger.log(`  - Project ID: ${projectId || 'None'}`);

  // Try Railway validation first (full validation)
  try {
    logger.log("\n🚂 Attempting Railway validation (full compilation)...");
    const railwayClient = createRailwayValidationClient();
    
    // Check if Railway validation is available
    const isRailwayAvailable = await railwayClient.checkHealth();
    if (isRailwayAvailable) {
      logger.log("✅ Railway validation available - using full compilation validation");
      
      const railwayResult = await railwayClient.validateProject(
        projectId || `validation-${Date.now()}`,
        generatedFiles,
        {
          enableTypeScript: true,
          enableSolidity: true,
          enableESLint: true,
          enableBuild: true,
          enableRuntimeChecks: true
        },
        projectDir // Pass the complete project directory
      );

      logger.log("\n📊 Railway Validation Results Summary:");
      logger.log("  ✅ Success:", railwayResult.success);
      logger.log("  ❌ Errors:", railwayResult.errors.length);
      logger.log("  ⚠️  Warnings:", railwayResult.warnings.length);
      logger.log("  ℹ️  Info:", railwayResult.info.length);
      logger.log("  ⏱️  Compilation Time:", railwayResult.compilationTime, "ms");
      logger.log("  📋 Validation Summary:", railwayResult.validationSummary);

      if (railwayResult.success) {
        logger.log("\n🎉 Railway validation successful - files are valid!");
        logger.log(`📁 Returning ${railwayResult.files.length} validated files`);
        return {
          validatedFiles: railwayResult.files,
          validationResult: {
            success: true,
            errors: [],
            warnings: railwayResult.warnings || [],
            info: railwayResult.info || []
          }
        };
      }

      logger.log("\n⚠️ Railway validation found errors - proceeding to surgical error fixing...");
      const fixedFiles = await fixRailwayCompilationErrors(railwayResult, callLLM, projectId, false);
      return {
        validatedFiles: fixedFiles,
        validationResult: {
          success: false,
          errors: railwayResult.errors,
          warnings: railwayResult.warnings || [],
          info: railwayResult.info || []
        }
      };
    } else {
      logger.log("⚠️ Railway validation not available - falling back to local validation");
    }
  } catch (railwayError) {
    logger.warn("⚠️ Railway validation failed - falling back to local validation:", railwayError);
  }

  // Fallback to local validation (limited in serverless)
  logger.log("\n🔧 Falling back to local CompilationValidator...");
  const validator = new CompilationValidator(process.cwd());
  
  // Convert to the format expected by CompilationValidator
  logger.log("🔄 Converting files for validation (follow-up mode)...");
  // For follow-up changes, we need to pass the actual file content for validation
  // The CompilationValidator will handle the diff application internally
  const filesForValidation = generatedFiles.map(file => ({
    filename: file.filename,
    content: file.content,
    operation: 'modify' as const
  }));
  logger.log(`  ✅ Converted ${filesForValidation.length} files for validation`);

  logger.log("\n🚀 Starting local compilation validation...");
  const compilationResult = await validator.validateProject(
    filesForValidation,
    currentFiles
  );

  logger.log("\n📊 Local Compilation Results Summary:");
  logger.log("  ✅ Success:", compilationResult.success);
  logger.log("  ❌ Errors:", compilationResult.errors.length);
  logger.log("  ⚠️  Warnings:", compilationResult.warnings.length);
  logger.log("  ℹ️  Info:", compilationResult.info.length);
  logger.log("  ⏱️  Compilation Time:", compilationResult.compilationTime, "ms");
  logger.log("  📋 Validation Summary:", compilationResult.validationSummary);

  if (compilationResult.success) {
    logger.log("\n🎉 Local validation successful - files are valid!");
    logger.log(`📁 Returning ${compilationResult.files.length} validated files`);
    return {
      validatedFiles: compilationResult.files,
      validationResult: {
        success: true,
        errors: [],
        warnings: compilationResult.warnings || [],
        info: compilationResult.info || []
      }
    };
  }

  logger.log("\n⚠️ Local validation found errors - proceeding to surgical error fixing...");
  const fixedFiles = await fixCompilationErrors(compilationResult, callLLM, projectId, false);
  return {
    validatedFiles: fixedFiles,
    validationResult: {
      success: false,
      errors: compilationResult.errors,
      warnings: compilationResult.warnings || [],
      info: compilationResult.info || []
    }
  };
}


/**
 * Fix Railway compilation errors using LLM-based error correction
 */
async function fixRailwayCompilationErrors(
  railwayResult: RailwayValidationResult,
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  isInitialGeneration: boolean = false
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(60));
  logger.log("🔧 STAGE 4: Railway Compilation Error Fixing Process");
  logger.log("=".repeat(60));
  logger.log(`📊 Input Summary:`);
  logger.log(`  - Total files: ${railwayResult.files.length}`);
  logger.log(`  - Railway errors: ${railwayResult.errors.length}`);
  logger.log(`  - Railway warnings: ${railwayResult.warnings.length}`);
  logger.log(`  - Railway info: ${railwayResult.info.length}`);
  logger.log(`  - Is Initial Generation: ${isInitialGeneration}`);
  
  // Use only Railway errors
  logger.log("\n🔍 Step 1: Processing Railway compilation errors...");
  const allErrors = railwayResult.errors;
  logger.log(`  ✅ Total errors to process: ${allErrors.length}`);
  
  // Group errors by file for easier processing
  logger.log("\n🔍 Step 2: Grouping errors by file...");
  const errorsByFile = new Map<string, RailwayValidationError[]>();
  for (const error of allErrors) {
    if (!errorsByFile.has(error.file)) {
      errorsByFile.set(error.file, []);
    }
    errorsByFile.get(error.file)!.push(error);
  }
  logger.log(`  ✅ Errors grouped into ${errorsByFile.size} files`);
  
  // Debug: Log error files and available files
  logger.log("\n🔍 Step 3: File matching analysis...");
  logger.log("  📋 Error files:", Array.from(errorsByFile.keys()));
  logger.log("  📋 Available files:", railwayResult.files.map(f => f.filename));
  
  // Get files that need fixing - try multiple matching strategies
  logger.log("\n🔍 Step 4: Finding files that need fixing...");
  let filesToFix = railwayResult.files.filter(file => 
    errorsByFile.has(file.filename)
  );
  logger.log(`  📊 Exact matches found: ${filesToFix.length} files`);

  // If no exact matches, try to match by basename or relative path
  if (filesToFix.length === 0) {
    logger.log("  🔍 No exact filename matches found, trying alternative matching strategies...");
    
    // Try matching by basename (filename without path)
    logger.log("  🔍 Attempting basename matching...");
    const errorBasenames = new Map<string, RailwayValidationError[]>();
    for (const [errorFile, errors] of errorsByFile.entries()) {
      const basename = path.basename(errorFile);
      if (!errorBasenames.has(basename)) {
        errorBasenames.set(basename, []);
      }
      errorBasenames.get(basename)!.push(...errors);
    }
    logger.log(`  📋 Error basenames: ${Array.from(errorBasenames.keys())}`);
    
    filesToFix = railwayResult.files.filter(file => {
      const fileBasename = path.basename(file.filename);
      return errorBasenames.has(fileBasename);
    });
    
    if (filesToFix.length > 0) {
      logger.log(`  ✅ Found ${filesToFix.length} files using basename matching`);
      logger.log(`  📋 Matched files: ${filesToFix.map(f => f.filename)}`);
      
      // Update errorsByFile to use the matched filenames
      const newErrorsByFile = new Map<string, RailwayValidationError[]>();
      for (const file of filesToFix) {
        const fileBasename = path.basename(file.filename);
        const errors = errorBasenames.get(fileBasename) || [];
        if (errors.length > 0) {
          newErrorsByFile.set(file.filename, errors);
          logger.log(`  🔗 Mapped ${fileBasename} -> ${file.filename} (${errors.length} errors)`);
        }
      }
      // Replace the original errorsByFile
      for (const [key, value] of newErrorsByFile.entries()) {
        errorsByFile.set(key, value);
      }
    } else {
      logger.log("  ❌ No basename matches found either");
    }
  }

  if (filesToFix.length === 0) {
    logger.log("\n❌ CRITICAL: No files identified for fixing!");
    logger.log("📋 This indicates a serious issue with error parsing or file mapping");
    logger.log("📋 Error files:", Array.from(errorsByFile.keys()));
    logger.log("📋 Available files:", railwayResult.files.map(f => f.filename));
    logger.log("📋 Returning original files - manual review required");
    return railwayResult.files;
  }

  // Create detailed error messages for LLM
  logger.log("\n🔍 Step 5: Creating error messages for LLM...");
  const errorMessages = Array.from(errorsByFile.entries()).map(([file, errors]) => {
    const errorList = errors.map(e => {
      const location = e.line ? `Line ${e.line}${e.column ? `:${e.column}` : ''}` : 'Unknown location';
      const suggestion = e.suggestion ? ` (Suggestion: ${e.suggestion})` : '';
      return `${location}: ${e.message} (${e.category})${suggestion}`;
    }).join('\n');
    return `${file}:\n${errorList}`;
  }).join('\n\n');

  logger.log(`  ✅ Prepared error messages for ${filesToFix.length} files`);
  logger.log(`  📋 Files to fix: ${filesToFix.map(f => f.filename)}`);
  logger.log("  📋 Error summary:");
  filesToFix.forEach(file => {
    const errors = errorsByFile.get(file.filename) || [];
    logger.log(`    - ${file.filename}: ${errors.length} errors`);
  });

  // Call LLM to fix errors
  logger.log("\n🤖 Step 6: Calling LLM to fix errors...");
  logger.log(`  📤 Preparing LLM prompt for ${filesToFix.length} files...`);
  
  const fixPrompt = getStage4CompilationFixPrompt(filesToFix, errorMessages, isInitialGeneration);
  logger.log(`  📏 Prompt length: ${fixPrompt.length} characters`);
  logger.log(`  🎯 Generation type: ${isInitialGeneration ? 'Complete files' : 'Surgical diffs'}`);
  
  logger.log("  🚀 Calling LLM...");
  const fixResponse = await callLLM(
    fixPrompt,
    "Stage 4: Railway Compilation Error Fixes",
    "STAGE_4_VALIDATOR"
  );
  logger.log(`  ✅ LLM response received: ${fixResponse.length} characters`);

  if (projectId) {
    logger.log("  📝 Logging response for debugging...");
    logStageResponse(projectId, 'stage4-railway-compilation-fixes', fixResponse, {
      railwayErrors: railwayResult.errors,
      filesToFix: filesToFix.length,
      errorSummary: {
        totalErrors: railwayResult.errors.length,
        errorsByCategory: railwayResult.errors.reduce((acc, e) => {
          acc[e.category] = (acc[e.category] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      }
    });
  }

  // Parse and return fixed files
  logger.log("\n🔍 Step 7: Parsing LLM response...");
  const fixedFiles = parseStage4ValidatorResponse(fixResponse);
  logger.log(`  ✅ Parsed ${fixedFiles.length} fixed files from LLM response`);
  
  // Merge fixed files with unchanged files
  logger.log("\n🔍 Step 8: Merging fixed and unchanged files...");
  const unchangedFiles = railwayResult.files.filter(file => 
    !errorsByFile.has(file.filename)
  );
  logger.log(`  📊 Unchanged files: ${unchangedFiles.length}`);
  logger.log(`  📊 Fixed files: ${fixedFiles.length}`);

  const finalFiles = [...unchangedFiles];
  
  // Add fixed files
  logger.log("  🔄 Processing fixed files...");
  for (const fixedFile of fixedFiles) {
    if (fixedFile.content) {
      logger.log(`    ✅ ${fixedFile.filename}: Complete content provided`);
      finalFiles.push({
        filename: fixedFile.filename,
        content: fixedFile.content
      });
    } else if (fixedFile.unifiedDiff) {
      logger.log(`    🔧 ${fixedFile.filename}: Applying unified diff...`);
      // Apply diff to get final content
      const originalFile = railwayResult.files.find(f => f.filename === fixedFile.filename);
      if (originalFile) {
        try {
          const updatedContent = applyDiffToContent(originalFile.content, fixedFile.unifiedDiff);
          finalFiles.push({
            filename: fixedFile.filename,
            content: updatedContent
          });
          logger.log(`    ✅ ${fixedFile.filename}: Diff applied successfully`);
        } catch (error) {
          logger.warn(`    ⚠️ ${fixedFile.filename}: Failed to apply diff:`, error);
          finalFiles.push(originalFile);
        }
      } else {
        logger.warn(`    ❌ ${fixedFile.filename}: Original file not found for diff application`);
      }
    } else {
      logger.warn(`    ⚠️ ${fixedFile.filename}: No content or diff provided`);
    }
  }

  // Validate ABI preservation before returning
  logger.log("\n🔍 Step 9: Validating ABI preservation...");
  const validationResult = validateABIPreservation(railwayResult.files, finalFiles);

  if (!validationResult.isValid) {
    logger.warn("\n⚠️ ABI VALIDATION WARNINGS:");
    validationResult.warnings.forEach(warning => logger.warn(`  ${warning}`));
    logger.warn("  → Original ABIs have been restored automatically");
  } else {
    logger.log("  ✅ No ABI modifications detected");
  }

  logger.log("\n" + "=".repeat(60));
  logger.log("🎉 STAGE 4: Railway Compilation Error Fixing Complete!");
  logger.log("=".repeat(60));
  logger.log(`📊 Final Results:`);
  logger.log(`  - Total files: ${finalFiles.length}`);
  logger.log(`  - Files fixed: ${fixedFiles.length}`);
  logger.log(`  - Files unchanged: ${unchangedFiles.length}`);
  logger.log(`  - Original errors: ${railwayResult.errors.length}`);
  logger.log(`  - ABI validation: ${validationResult.isValid ? '✅ Passed' : '⚠️ Issues auto-fixed'}`);
  logger.log("=".repeat(60));

  return finalFiles;
}

/**
 * Fix compilation errors using LLM-based error correction
 */
async function fixCompilationErrors(
  compilationResult: CompilationResult,
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  isInitialGeneration: boolean = false
): Promise<{ filename: string; content: string }[]> {
  logger.log("\n" + "=".repeat(60));
  logger.log("🔧 STAGE 4: Compilation Error Fixing Process");
  logger.log("=".repeat(60));
  logger.log(`📊 Input Summary:`);
  logger.log(`  - Total files: ${compilationResult.files.length}`);
  logger.log(`  - Compilation errors: ${compilationResult.errors.length}`);
  logger.log(`  - Compilation warnings: ${compilationResult.warnings.length}`);
  logger.log(`  - Compilation info: ${compilationResult.info.length}`);
  logger.log(`  - Is Initial Generation: ${isInitialGeneration}`);
  
  // Use only compilation errors (common issues detection removed due to false positives)
  logger.log("\n🔍 Step 1: Processing compilation errors...");
  const allErrors = compilationResult.errors;
  logger.log(`  ✅ Total errors to process: ${allErrors.length}`);
  
  // Group errors by file for easier processing
  logger.log("\n🔍 Step 2: Grouping errors by file...");
  const errorsByFile = CompilationErrorUtils.groupErrorsByFile(allErrors);
  logger.log(`  ✅ Errors grouped into ${errorsByFile.size} files`);
  
  // Debug: Log error files and available files
  logger.log("\n🔍 Step 3: File matching analysis...");
  logger.log("  📋 Error files:", Array.from(errorsByFile.keys()));
  logger.log("  📋 Available files:", compilationResult.files.map(f => f.filename));
  
  // Get files that need fixing - try multiple matching strategies
  logger.log("\n🔍 Step 4: Finding files that need fixing...");
  let filesToFix = compilationResult.files.filter(file => 
    errorsByFile.has(file.filename)
  );
  logger.log(`  📊 Exact matches found: ${filesToFix.length} files`);

  // If no exact matches, try to match by basename or relative path
  if (filesToFix.length === 0) {
    logger.log("  🔍 No exact filename matches found, trying alternative matching strategies...");
    
    // Try matching by basename (filename without path)
    logger.log("  🔍 Attempting basename matching...");
    const errorBasenames = new Map<string, CompilationError[]>();
    for (const [errorFile, errors] of errorsByFile.entries()) {
      const basename = path.basename(errorFile);
      if (!errorBasenames.has(basename)) {
        errorBasenames.set(basename, []);
      }
      errorBasenames.get(basename)!.push(...errors);
    }
    logger.log(`  📋 Error basenames: ${Array.from(errorBasenames.keys())}`);
    
    filesToFix = compilationResult.files.filter(file => {
      const fileBasename = path.basename(file.filename);
      return errorBasenames.has(fileBasename);
    });
    
    if (filesToFix.length > 0) {
      logger.log(`  ✅ Found ${filesToFix.length} files using basename matching`);
      logger.log(`  📋 Matched files: ${filesToFix.map(f => f.filename)}`);
      
      // Update errorsByFile to use the matched filenames
      const newErrorsByFile = new Map<string, CompilationError[]>();
      for (const file of filesToFix) {
        const fileBasename = path.basename(file.filename);
        const errors = errorBasenames.get(fileBasename) || [];
        if (errors.length > 0) {
          newErrorsByFile.set(file.filename, errors);
          logger.log(`  🔗 Mapped ${fileBasename} -> ${file.filename} (${errors.length} errors)`);
        }
      }
      // Replace the original errorsByFile
      for (const [key, value] of newErrorsByFile.entries()) {
        errorsByFile.set(key, value);
      }
    } else {
      logger.log("  ❌ No basename matches found either");
    }
  }

  if (filesToFix.length === 0) {
    logger.log("\n❌ CRITICAL: No files identified for fixing!");
    logger.log("📋 This indicates a serious issue with error parsing or file mapping");
    logger.log("📋 Error files:", Array.from(errorsByFile.keys()));
    logger.log("📋 Available files:", compilationResult.files.map(f => f.filename));
    logger.log("📋 Returning original files - manual review required");
    return compilationResult.files;
  }

  // Create detailed error messages for LLM
  logger.log("\n🔍 Step 5: Creating error messages for LLM...");
  const errorMessages = Array.from(errorsByFile.entries()).map(([file, errors]) => {
    const errorList = errors.map(e => {
      const location = e.line ? `Line ${e.line}${e.column ? `:${e.column}` : ''}` : 'Unknown location';
      const suggestion = e.suggestion ? ` (Suggestion: ${e.suggestion})` : '';
      return `${location}: ${e.message} (${e.category})${suggestion}`;
    }).join('\n');
    return `${file}:\n${errorList}`;
  }).join('\n\n');

  logger.log(`  ✅ Prepared error messages for ${filesToFix.length} files`);
  logger.log(`  📋 Files to fix: ${filesToFix.map(f => f.filename)}`);
  logger.log("  📋 Error summary:");
  filesToFix.forEach(file => {
    const errors = errorsByFile.get(file.filename) || [];
    logger.log(`    - ${file.filename}: ${errors.length} errors`);
  });

  // Call LLM to fix errors
  logger.log("\n🤖 Step 6: Calling LLM to fix errors...");
  logger.log(`  📤 Preparing LLM prompt for ${filesToFix.length} files...`);
  
  const fixPrompt = getStage4CompilationFixPrompt(filesToFix, errorMessages, isInitialGeneration);
  logger.log(`  📏 Prompt length: ${fixPrompt.length} characters`);
  logger.log(`  🎯 Generation type: ${isInitialGeneration ? 'Complete files' : 'Surgical diffs'}`);
  
  logger.log("  🚀 Calling LLM...");
  const fixResponse = await callLLM(
    fixPrompt,
    "Stage 4: Compilation Error Fixes",
    "STAGE_4_VALIDATOR"
  );
  logger.log(`  ✅ LLM response received: ${fixResponse.length} characters`);

  if (projectId) {
    logger.log("  📝 Logging response for debugging...");
    logStageResponse(projectId, 'stage4-compilation-fixes', fixResponse, {
      compilationErrors: compilationResult.errors,
      filesToFix: filesToFix.length,
      errorSummary: CompilationErrorUtils.getErrorSummary(compilationResult.errors)
    });
  }

  // Parse and return fixed files
  logger.log("\n🔍 Step 7: Parsing LLM response...");
  const fixedFiles = parseStage4ValidatorResponse(fixResponse);
  logger.log(`  ✅ Parsed ${fixedFiles.length} fixed files from LLM response`);
  
  // Merge fixed files with unchanged files
  logger.log("\n🔍 Step 8: Merging fixed and unchanged files...");
  const unchangedFiles = compilationResult.files.filter(file => 
    !errorsByFile.has(file.filename)
  );
  logger.log(`  📊 Unchanged files: ${unchangedFiles.length}`);
  logger.log(`  📊 Fixed files: ${fixedFiles.length}`);

  const finalFiles = [...unchangedFiles];
  
  // Add fixed files
  logger.log("  🔄 Processing fixed files...");
  for (const fixedFile of fixedFiles) {
    if (fixedFile.content) {
      logger.log(`    ✅ ${fixedFile.filename}: Complete content provided`);
      finalFiles.push({
        filename: fixedFile.filename,
        content: fixedFile.content
      });
    } else if (fixedFile.unifiedDiff) {
      logger.log(`    🔧 ${fixedFile.filename}: Applying unified diff...`);
      // Apply diff to get final content
      const originalFile = compilationResult.files.find(f => f.filename === fixedFile.filename);
      if (originalFile) {
        try {
          const updatedContent = applyDiffToContent(originalFile.content, fixedFile.unifiedDiff);
          finalFiles.push({
            filename: fixedFile.filename,
            content: updatedContent
          });
          logger.log(`    ✅ ${fixedFile.filename}: Diff applied successfully`);
        } catch (error) {
          logger.warn(`    ⚠️ ${fixedFile.filename}: Failed to apply diff:`, error);
          finalFiles.push(originalFile);
        }
      } else {
        logger.warn(`    ❌ ${fixedFile.filename}: Original file not found for diff application`);
      }
    } else {
      logger.warn(`    ⚠️ ${fixedFile.filename}: No content or diff provided`);
    }
  }

  // Validate ABI preservation before returning
  logger.log("\n🔍 Step 9: Validating ABI preservation...");
  const validationResult = validateABIPreservation(compilationResult.files, finalFiles);

  if (!validationResult.isValid) {
    logger.warn("\n⚠️ ABI VALIDATION WARNINGS:");
    validationResult.warnings.forEach(warning => logger.warn(`  ${warning}`));
    logger.warn("  → Original ABIs have been restored automatically");
  } else {
    logger.log("  ✅ No ABI modifications detected");
  }

  logger.log("\n" + "=".repeat(60));
  logger.log("🎉 STAGE 4: Compilation Error Fixing Complete!");
  logger.log("=".repeat(60));
  logger.log(`📊 Final Results:`);
  logger.log(`  - Total files: ${finalFiles.length}`);
  logger.log(`  - Files fixed: ${fixedFiles.length}`);
  logger.log(`  - Files unchanged: ${unchangedFiles.length}`);
  logger.log(`  - Original errors: ${compilationResult.errors.length}`);
  logger.log(`  - ABI validation: ${validationResult.isValid ? '✅ Passed' : '⚠️ Issues auto-fixed'}`);
  logger.log("=".repeat(60));

  return finalFiles;
}

/**
 * Validate that ABI/contractConfig files haven't been improperly modified
 */
function validateABIPreservation(
  originalFiles: { filename: string; content: string }[],
  fixedFiles: { filename: string; content: string }[]
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const contractConfigPattern = /contractConfig\.ts$/;

  for (const fixedFile of fixedFiles) {
    // Check if this is a contractConfig file
    if (contractConfigPattern.test(fixedFile.filename)) {
      const originalFile = originalFiles.find(f => f.filename === fixedFile.filename);

      if (!originalFile) {
        continue; // New file, skip validation
      }

      // Extract ABI from both files
      const originalABI = extractABIFromContent(originalFile.content);
      const fixedABI = extractABIFromContent(fixedFile.content);

      if (!originalABI || !fixedABI) {
        continue; // Can't validate if we can't extract ABIs
      }

      // Count functions in both ABIs
      const originalFunctions = originalABI.match(/"name":\s*"[^"]+"/g) || [];
      const fixedFunctions = fixedABI.match(/"name":\s*"[^"]+"/g) || [];

      // Check if functions were removed
      if (fixedFunctions.length < originalFunctions.length) {
        const removed = originalFunctions.length - fixedFunctions.length;
        warnings.push(
          `⚠️ ${fixedFile.filename}: ABI was modified! ${removed} function(s) removed (${originalFunctions.length} → ${fixedFunctions.length}). ` +
          `Stage 4 should NEVER remove ABI functions. Restoring original ABI.`
        );

        // Restore original ABI
        fixedFile.content = originalFile.content;
      }

      // Check if function names changed (excluding Events)
      const originalFunctionNames = extractFunctionNamesFromABI(originalFile.content);
      const fixedFunctionNames = extractFunctionNamesFromABI(fixedFile.content);

      const renamedFunctions = originalFunctionNames.filter(name =>
        !fixedFunctionNames.includes(name)
      );

      if (renamedFunctions.length > 0) {
        warnings.push(
          `⚠️ ${fixedFile.filename}: Function names changed in ABI! Missing: ${renamedFunctions.join(', ')}. ` +
          `Stage 4 should NEVER rename ABI functions. Restoring original ABI.`
        );

        // Restore original ABI
        fixedFile.content = originalFile.content;
      }
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

/**
 * Extract ABI array content from contractConfig file
 */
function extractABIFromContent(content: string): string | null {
  const abiMatch = content.match(/export\s+const\s+\w+_ABI\s*=\s*\[([\s\S]*?)\]\s+as\s+const;/);
  return abiMatch ? abiMatch[1] : null;
}

/**
 * Extract function names from ABI (excluding events, errors, constructor)
 */
function extractFunctionNamesFromABI(content: string): string[] {
  const functionNames: string[] = [];
  const abiContent = extractABIFromContent(content);

  if (!abiContent) {
    return functionNames;
  }

  // Match all ABI entries
  const entries = abiContent.split(/\},\s*\{/);

  for (const entry of entries) {
    // Check if this is a function (not event, error, or constructor)
    if (entry.includes('"type":\s*"function"') || entry.includes('"type": "function"')) {
      const nameMatch = entry.match(/"name":\s*"([^"]+)"/);
      if (nameMatch) {
        functionNames.push(nameMatch[1]);
      }
    }
  }

  return functionNames;
}

/**
 * Generate Stage 4 compilation fix prompt
 */
function getStage4CompilationFixPrompt(
  filesToFix: { filename: string; content: string }[],
  errorMessages: string,
  isInitialGeneration: boolean
): string {
  return `
ROLE: Compilation Error Fixer for Next.js 15 + TypeScript + React + Solidity

COMPILATION ERRORS FOUND:
${errorMessages}

FILES TO FIX:
${filesToFix.map((f) => `---${f.filename}---\n${f.content}`).join("\n\n")}

TASK: Fix the compilation errors above. ${isInitialGeneration ? 'Generate complete corrected files.' : 'Generate surgical diff patches to fix only the specific compilation errors.'}

CRITICAL REQUIREMENTS:
- Fix ALL compilation errors listed above
- Preserve existing functionality and UI implementations
- Only fix the specific errors mentioned
- Do not introduce new errors
- Maintain code quality and best practices
- Ensure TypeScript compilation passes
- Ensure Solidity contracts compile successfully
- Follow ESLint rules and best practices

🚨 ABSOLUTELY FORBIDDEN - DO NOT MODIFY:
- NEVER modify ABI arrays in contractConfig files (src/lib/contractConfig.ts, lib/contractConfig.ts)
- NEVER remove functions from ABIs - the ABI must remain complete
- NEVER rename functions in ABIs to match component usage - fix the component instead
- NEVER "simplify" or "optimize" contract interface files
- IF errors involve ABI function names: Fix the component to use the correct function name from the ABI
- IF errors claim a function is missing: The function IS in the ABI, the component has the wrong name
- CONTRACT INTERFACES ARE SOURCE OF TRUTH - components must match them, not vice versa

⚠️ IMPORT PATH CASE SENSITIVITY - CRITICAL FOR PRODUCTION:
- ALWAYS use exact case for import paths: '@/components/ui/Button' NOT '@/components/ui/button'
- Boilerplate components use PascalCase: Button.tsx, Input.tsx, Card.tsx, Select.tsx, Tabs.tsx
- Development (macOS/Windows) is case-insensitive BUT production (Railway/Linux) is case-sensitive
- Wrong case = works locally but FAILS in production with "Module not found" error
- Common mistakes to AVOID: 'button'→'Button', 'input'→'Input', 'card'→'Card', 'select'→'Select'
- When adding missing imports: Check existing imports in the same file or similar files for correct casing
- IF error is "Cannot find name 'Button'": Import from '@/components/ui/Button' (capital B)

COMPILATION ERROR TYPES:
1. TypeScript Errors: Fix type mismatches, missing imports, interface violations, function signatures
   - For readonly array errors: Use array spreading [...array] to convert to mutable
   - For ABI function errors: Check the ABI for the correct function name, update the component
2. Solidity Errors: Fix contract compilation issues, syntax errors, type mismatches
3. ESLint Errors: Fix code style and best practice violations
4. Build Errors: Fix Next.js build failures, missing dependencies
5. Runtime Errors: Fix potential runtime issues, memory leaks, error handling

${isInitialGeneration ? `
OUTPUT FORMAT - Complete Files:
__START_JSON__
[
  {
    "filename": "EXACT_SAME_FILENAME",
    "content": "Complete corrected file content with all compilation errors fixed"
  }
]
__END_JSON__
` : `
OUTPUT FORMAT - Surgical Diffs:
__START_JSON__
[
  {
    "filename": "EXACT_SAME_FILENAME",
    "operation": "modify",
    "unifiedDiff": "@@ -X,Y +X,Z @@\n context\n-old line\n+new line\n context",
    "diffHunks": [
      {
        "oldStart": X,
        "oldLines": Y,
        "newStart": X,
        "newLines": Z,
        "lines": [" context", "-old line", "+new line", " context"]
      }
    ]
  }
]
__END_JSON__
`}

CRITICAL: Return ONLY the JSON array above. No explanations, no text, no markdown formatting.
`;
}

// ========================================================================
// LEGACY UNIFIED PIPELINE (Backward Compatibility)
// ========================================================================

/**
 * @deprecated Use executeInitialGenerationPipeline or executeFollowUpPipeline instead
 * Legacy unified pipeline maintained for backward compatibility
 */
export async function executeMultiStagePipeline(
  userPrompt: string,
  currentFiles: { filename: string; content: string }[],
  callLLM: (
    systemPrompt: string,
    userPrompt: string,
    stageName: string,
    stageType?: keyof typeof STAGE_MODEL_CONFIG
  ) => Promise<string>,
  projectId?: string,
  isInitialGeneration: boolean = false
): Promise<{ files: { filename: string; content: string }[]; intentSpec: IntentSpec }> {
  // Delegate to the appropriate specialized pipeline
  logger.log("⚠️ Using legacy executeMultiStagePipeline - consider using specialized pipelines");
  
  if (isInitialGeneration) {
    return executeInitialGenerationPipeline(userPrompt, currentFiles, callLLM, projectId);
  } else {
    return executeFollowUpPipeline(userPrompt, currentFiles, callLLM, projectId);
  }
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

// Helper function to log LLM calls with timing (Legacy - not used in new pipelines)
// Helper function to log LLM calls with timing
export async function callLLMWithLogging(
  systemPrompt: string,
  userPrompt: string,
  callLLM: (systemPrompt: string, userPrompt: string) => Promise<string>,
  stageName: string
): Promise<string> {
  logger.log(`\n🤖 LLM Call - ${stageName}`);
  logger.log("📤 Input:");
  logger.log("  System Prompt Length:", systemPrompt.length, "chars");
  logger.log("  User Prompt:", userPrompt);

  const startTime = Date.now();
  const response = await callLLM(systemPrompt, userPrompt);
  const endTime = Date.now();

  logger.log("📥 Output:");
  logger.log("  Response Length:", response.length, "chars");
  logger.log("  Response Time:", endTime - startTime, "ms");
  logger.log("  Raw Response Preview:", response.substring(0, 300) + "...");

  return response;
}
