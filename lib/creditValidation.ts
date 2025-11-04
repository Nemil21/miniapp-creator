/**
 * Server-side credit validation utility
 * Validates user credits before allowing API operations
 */

import { EarnKit } from '@earnkit/earn';

interface CreditValidationResult {
    isValid: boolean;
    error?: string;
    currentCredits?: string;
}

/**
 * Check if credit system is disabled via environment variable
 */
export function isCreditsDisabled(): boolean {
    return process.env.NEXT_PUBLIC_CREDS_OFF === 'true';
}

/**
 * Initialize EarnKit instance for server-side validation
 */
function getEarnKitInstance(): EarnKit | null {
    const agentId = process.env.NEXT_PUBLIC_EARNKIT_AGENT_ID;
    const apiKey = process.env.NEXT_PUBLIC_EARNKIT_API_KEY;

    if (!agentId || !apiKey) {
        console.warn('EarnKit credentials not configured for server-side validation');
        return null;
    }

    return new EarnKit({
        agentId,
        apiKey,
    });
}

/**
 * Validate if a wallet has sufficient credits for an operation
 * @param walletAddress - User's wallet address
 * @param requiredCredits - Number of credits required (default: 1)
 * @returns Validation result
 */
export async function validateCredits(
    walletAddress: string,
    requiredCredits: number = 1
): Promise<CreditValidationResult> {
    // If credits are disabled, allow all operations
    if (isCreditsDisabled()) {
        console.log('Credits disabled - skipping validation');
        return { isValid: true };
    }

    // Get EarnKit instance
    const earnKit = getEarnKitInstance();
    if (!earnKit) {
        // If EarnKit is not configured, allow operation (fail open)
        console.warn('EarnKit not configured - allowing operation');
        return { isValid: true };
    }

    if (!walletAddress) {
        return {
            isValid: false,
            error: 'Wallet address is required for credit validation'
        };
    }

    try {
        // Get user's current balance
        const balance = await earnKit.getBalance({ walletAddress });
        const currentCredits = parseInt(balance.credits);

        console.log(`Credit validation for ${walletAddress}: ${currentCredits} credits available, ${requiredCredits} required`);

        if (currentCredits < requiredCredits) {
            return {
                isValid: false,
                error: `Insufficient credits. Required: ${requiredCredits}, Available: ${currentCredits}`,
                currentCredits: balance.credits
            };
        }

        return {
            isValid: true,
            currentCredits: balance.credits
        };

    } catch (error) {
        console.error('Error validating credits:', error);
        // Fail open - don't block operations if validation fails
        return {
            isValid: true,
            error: 'Credit validation service unavailable - allowing operation'
        };
    }
}

/**
 * Track credit usage for an operation
 * @param walletAddress - User's wallet address
 * @param credits - Number of credits to track (default: 1)
 * @returns eventId for later capture, or null if tracking is disabled
 */
export async function trackCredits(
    walletAddress: string,
    credits: number = 1
): Promise<string | null> {
    // If credits are disabled, return null
    if (isCreditsDisabled()) {
        return null;
    }

    const earnKit = getEarnKitInstance();
    if (!earnKit || !walletAddress) {
        return null;
    }

    try {
        const trackResponse = await earnKit.track({
            walletAddress,
            credits,
        } as { walletAddress: string; credits: number });

        if (trackResponse.insufficientCredits) {
            throw new Error('Insufficient credits');
        }

        return trackResponse.eventId;
    } catch (error) {
        console.error('Error tracking credits:', error);
        throw error;
    }
}

/**
 * Capture/charge credits after successful operation
 * @param eventId - Event ID from track operation
 */
export async function captureCredits(eventId: string): Promise<void> {
    // If credits are disabled, do nothing
    if (isCreditsDisabled()) {
        return;
    }

    const earnKit = getEarnKitInstance();
    if (!earnKit || !eventId) {
        return;
    }

    try {
        await earnKit.capture({ eventId });
        console.log('Credits captured successfully:', eventId);
    } catch (error) {
        console.error('Error capturing credits:', error);
        // Don't throw - we don't want to fail the operation if capture fails
    }
}



