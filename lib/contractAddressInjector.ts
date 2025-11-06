import { logger } from "./logger";
/**
 * Contract Address Injector
 *
 * Automatically injects deployed contract addresses into generated project files.
 * Handles src/lib/contracts.ts and other contract configuration files.
 */

export interface ContractAddressMap {
  [contractName: string]: string; // Contract name -> deployed address
}

/**
 * Inject a single contract address using simple replace with fallback
 *
 * @param content - File content
 * @param contractAddress - Deployed contract address
 * @returns Object with updated content and success status
 */
function injectSingleContractAddress(
  content: string,
  contractAddress: string
): { updated: string; success: boolean } {

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  // ============================================================
  // PRIMARY: Simple Replace
  // ============================================================
  if (content.includes(ZERO_ADDRESS)) {
    const updated = content.replace(ZERO_ADDRESS, contractAddress);

    // Verify it worked
    if (updated.includes(contractAddress)) {
      logger.log('✅ Contract address injected via simple replace');
      return { updated, success: true };
    }
  }

  // ============================================================
  // FALLBACK: Line-by-Line Search
  // ============================================================
  logger.log('⚠️ Simple replace failed, trying fallback...');

  const lines = content.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('CONTRACT_ADDRESS') && lines[i].includes(ZERO_ADDRESS)) {
      lines[i] = lines[i].replace(ZERO_ADDRESS, contractAddress);
      found = true;
      logger.log(`✅ Contract address injected via fallback (line ${i + 1})`);
      break; // Only replace first occurrence
    }
  }

  if (found) {
    return { updated: lines.join('\n'), success: true };
  }

  // Failed
  logger.error('❌ Contract address injection failed');
  logger.error('📄 File content preview:', content.substring(0, 300));
  return { updated: content, success: false };
}

/**
 * Inject contract addresses into src/lib/contracts.ts
 *
 * @param contractFileContent - Original content of src/lib/contracts.ts
 * @param contractAddresses - Map of contract names to deployed addresses
 * @returns Updated file content with injected addresses
 */
export function injectContractAddresses(
  contractFileContent: string,
  contractAddresses: ContractAddressMap
): string {
  let updatedContent = contractFileContent;

  // Get the first contract address (for simple replace approach)
  const firstContractAddress = Object.values(contractAddresses)[0];
  const firstContractName = Object.keys(contractAddresses)[0];

  if (!firstContractAddress) {
    logger.warn('⚠️ No contract addresses provided');
    return contractFileContent;
  }

  logger.log(`🔍 Attempting to inject contract address: ${firstContractName} -> ${firstContractAddress}`);

  // Validate address format
  if (!isValidEthereumAddress(firstContractAddress)) {
    logger.error(`❌ Invalid address format: ${firstContractAddress}`);
    return contractFileContent;
  }

  // Try simple replace with fallback
  const result = injectSingleContractAddress(contractFileContent, firstContractAddress);

  if (result.success) {
    updatedContent = result.updated;
    logger.log(`✅ Successfully injected ${firstContractName} address`);
  } else {
    logger.error(`❌ Failed to inject ${firstContractName} address`);
  }

  // If there are multiple contracts, try to inject them too
  if (Object.keys(contractAddresses).length > 1) {
    logger.log(`🔍 Found ${Object.keys(contractAddresses).length} total contracts, attempting to inject remaining...`);

    for (const [contractName, address] of Object.entries(contractAddresses)) {
      if (contractName === firstContractName) continue; // Skip first one, already done

      if (isValidEthereumAddress(address)) {
        // Try to find and replace any remaining zero addresses
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        if (updatedContent.includes(ZERO_ADDRESS)) {
          updatedContent = updatedContent.replace(ZERO_ADDRESS, address);
          logger.log(`✅ Injected additional contract: ${contractName} -> ${address}`);
        }
      }
    }
  }

  return updatedContent;
}


/**
 * Validate Ethereum address format
 */
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Update multiple files with contract addresses
 *
 * @param files - Array of project files
 * @param contractAddresses - Map of contract names to deployed addresses
 * @returns Updated files with injected addresses
 */
export function updateFilesWithContractAddresses(
  files: { filename: string; content: string }[],
  contractAddresses: ContractAddressMap
): { filename: string; content: string }[] {
  logger.log(`\n${"=".repeat(60)}`);
  logger.log(`🔧 INJECTING CONTRACT ADDRESSES`);
  logger.log(`${"=".repeat(60)}`);
  logger.log(`📋 Contract addresses to inject:`, contractAddresses);

  return files.map(file => {
    // Only process contract configuration files
    if (file.filename === 'src/lib/contracts.ts' ||
        file.filename === 'lib/contracts.ts' ||
        file.filename.includes('contractConfig')) {

      logger.log(`\n📄 Processing file: ${file.filename}`);
      const updatedContent = injectContractAddresses(file.content, contractAddresses);

      if (updatedContent !== file.content) {
        logger.log(`✅ Updated ${file.filename} with deployed addresses`);
        return {
          ...file,
          content: updatedContent
        };
      } else {
        logger.warn(`⚠️ No changes made to ${file.filename} - check if zero address is present`);
      }
    }

    return file;
  });
}

/**
 * Parse deployment info from external API response
 *
 * The external deploy API returns contract addresses in various formats:
 * - deploymentInfo.json content
 * - Direct contractAddresses object
 * - Nested in deployment response
 */
export function parseContractAddressesFromDeployment(
  deploymentResponse: unknown
): ContractAddressMap | null {
  if (!deploymentResponse || typeof deploymentResponse !== 'object') {
    return null;
  }

  const response = deploymentResponse as Record<string, unknown>;

  // Try different possible locations for contract addresses

  // 1. Direct contractAddresses field
  if (response.contractAddresses && typeof response.contractAddresses === 'object') {
    logger.log(`✅ Found contractAddresses in deployment response`);
    return response.contractAddresses as ContractAddressMap;
  }

  // 2. contractDeployment field (from external API)
  if (response.contractDeployment && typeof response.contractDeployment === 'object') {
    const contractDeployment = response.contractDeployment as Record<string, unknown>;
    const addresses: ContractAddressMap = {};

    // Extract contract addresses from contractDeployment
    // Filter out metadata fields like deployer, network, chainId, rpcUrl, timestamp, transactionHash
    const metadataFields = ['deployer', 'network', 'chainid', 'rpcurl', 'timestamp', 'transactionhash'];

    for (const [key, value] of Object.entries(contractDeployment)) {
      if (typeof value === 'string' &&
          /^0x[a-fA-F0-9]{40}$/.test(value) &&
          !metadataFields.includes(key.toLowerCase())) {
        addresses[key] = value;
        logger.log(`  📝 Found contract: ${key} -> ${value}`);
      }
    }

    if (Object.keys(addresses).length > 0) {
      logger.log(`✅ Extracted ${Object.keys(addresses).length} contract addresses from contractDeployment`);
      return addresses;
    }
  }

  // 3. deploymentInfo field
  if (response.deploymentInfo && typeof response.deploymentInfo === 'object') {
    const deploymentInfo = response.deploymentInfo as Record<string, unknown>;
    const addresses: ContractAddressMap = {};

    // Extract contract addresses from deploymentInfo
    for (const [key, value] of Object.entries(deploymentInfo)) {
      if (typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)) {
        addresses[key] = value;
      }
    }

    if (Object.keys(addresses).length > 0) {
      logger.log(`✅ Extracted ${Object.keys(addresses).length} contract addresses from deploymentInfo`);
      return addresses;
    }
  }

  // 4. Look for any fields that look like Ethereum addresses
  const addresses: ContractAddressMap = {};
  for (const [key, value] of Object.entries(response)) {
    if (typeof value === 'string' &&
        /^0x[a-fA-F0-9]{40}$/.test(value) &&
        !key.toLowerCase().includes('deployer') &&
        !key.toLowerCase().includes('owner')) {
      addresses[key] = value;
    }
  }

  if (Object.keys(addresses).length > 0) {
    logger.log(`✅ Found ${Object.keys(addresses).length} potential contract addresses in response`);
    return addresses;
  }

  logger.log(`⚠️  No contract addresses found in deployment response`);
  return null;
}
