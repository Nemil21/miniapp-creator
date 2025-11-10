"use client";
import { logger } from "../../lib/logger";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import type { EarnKit, UserBalance } from "@earnkit/earn";
import TopUpDialog from "./top-up-dialog";
import { Button } from "./ui/button";
import WalletButton from "./WalletButton";

interface BalanceDisplayProps {
    activeAgent: EarnKit;
    feeModelType: "free-tier" | "credit-based";
}

export default function BalanceDisplay({ activeAgent, feeModelType }: BalanceDisplayProps) {
    const { ready, authenticated, linkWallet } = usePrivy();
    const { wallets } = useWallets();
    const walletAddress = wallets[0]?.address;

    // Check if user only has embedded wallet
    const hasOnlyEmbeddedWallet = wallets.length > 0 && 
        wallets.every(w => w.walletClientType === 'privy');

    logger.log('💰 BalanceDisplay render:', {
        ready,
        authenticated,
        hasWallet: !!wallets[0],
        walletAddress: walletAddress ? `${walletAddress.substring(0, 6)}...` : 'none',
        feeModelType,
        hasActiveAgent: !!activeAgent,
        hasOnlyEmbeddedWallet
    });

    // Balance fetching with React Query (only if activeAgent exists)
    const { data: balance, isLoading: loading, refetch: refetchBalance } = useQuery<UserBalance>({
        queryKey: ["balance", feeModelType, walletAddress],
        queryFn: async () => {
            if (!walletAddress || !activeAgent) throw new Error("Wallet not connected or agent not available");
            return activeAgent.getBalance({ walletAddress });
        },
        enabled: !!activeAgent && !!walletAddress && ready && authenticated,
        placeholderData: { eth: "0", credits: "0" },
        staleTime: 1000 * 30, // 30 seconds
        refetchInterval: 1000 * 60, // Refetch every minute
    });

    const handleBalanceUpdate = () => {
        // React Query will automatically refetch, but we can also trigger it manually
        refetchBalance();
    };

    // If no activeAgent (credits disabled), just show wallet button for auth
    if (!activeAgent) {
        return <WalletButton />;
    }

    // Show wallet button if not authenticated
    if (!ready || !authenticated || !walletAddress) {
        return <WalletButton />;
    }

    // Show balance and top-up when authenticated and credits enabled
    return (
        <div className="flex items-center gap-3">
            {hasOnlyEmbeddedWallet && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={linkWallet}
                    className="px-3 py-1.5 text-xs font-medium text-black-60 transition-colors cursor-pointer rounded-3xl"
                    title="Currently using temporary wallet. Click to connect your own wallet (MetaMask, Coinbase, etc.)"
                >
                    Connect Wallet
                </Button>
            )}
            <div className="flex items-center gap-2">
                <span className="text-sm text-black-60">
                    Balance: {loading ? "..." : balance ? `${balance.credits} Credits` : "0 Credits"}
                </span>
            </div>
            <TopUpDialog
                activeAgent={activeAgent}
                feeModelType={feeModelType}
                onSuccess={handleBalanceUpdate}
            >
                <Button
                    variant="outline"
                    size="sm"
                    className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer rounded-3xl"
                >
                    Top Up
                </Button>
            </TopUpDialog>
        </div>
    );
}


