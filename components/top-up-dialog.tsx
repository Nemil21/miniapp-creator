"use client";
import { logger } from "@/lib/logger";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import type { EarnKit, TopUpOption, UserBalance } from "@earnkit/earn";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { createWalletClient, custom, keccak256, parseAbi, toBytes } from "viem";
import { base } from "viem/chains";

interface EscrowContract {
    address: string;
    depositFunction: {
        name: string;
        signature: string;
        agentIdParam: string;
    };
    network: {
        chainId: number;
        name: string;
        rpcUrl: string;
    };
}

interface TopUpDialogProps {
    activeAgent: EarnKit;
    feeModelType: "free-tier" | "credit-based";
    onSuccess: (newBalance: UserBalance) => void;
    children: React.ReactNode;
}

export default function TopUpDialog({
    activeAgent,
    feeModelType,
    onSuccess,
    children,
}: TopUpDialogProps) {
    const [topUpOptions, setTopUpOptions] = useState<TopUpOption[] | null>(null);
    const [escrowContract, setEscrowContract] = useState<EscrowContract | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [open, setOpen] = useState<boolean>(false);
    const [processingOption, setProcessingOption] = useState<string | null>(null);

    const { ready, authenticated } = usePrivy();
    const { wallets } = useWallets();
    const queryClient = useQueryClient();

    // Data Fetching - fetch top-up details when dialog opens
    useEffect(() => {
        if (open && !topUpOptions) {
            const fetchTopUpDetails = async () => {
                setLoading(true);
                try {
                    const response = await activeAgent.getTopUpDetails();
                    logger.log(response, "api response top up details");

                    setTopUpOptions(response.options);
                    setEscrowContract(response.escrowContract);
                } catch (error) {
                    logger.error("Error fetching top-up details:", error);
                    toast.error("Failed to load top-up options. Please try again.");
                } finally {
                    setLoading(false);
                }
            };

            fetchTopUpDetails();
        }
    }, [open, activeAgent, topUpOptions]);

    // Core Logic - handle top-up transaction using contract call
    const handleTopUp = async (option: TopUpOption) => {
        // Guard clauses
        if (!ready || !authenticated) {
            toast.error("Please connect your wallet first");
            return;
        }

        if (!wallets[0]?.address) {
            toast.error("No wallet connected");
            return;
        }

        if (!escrowContract) {
            toast.error("Escrow contract not loaded");
            return;
        }

        const wallet = wallets[0];
        setProcessingOption(option.label);

        let txToast: string | undefined;
        try {
            txToast = toast.loading("Preparing transaction...");

            // Switch to Base network
            await wallet.switchChain(base.id);

            // Get Ethereum provider
            const eip1193 = await wallet.getEthereumProvider();

            // Create wallet client
            const walletClient = createWalletClient({
                chain: base,
                transport: custom(eip1193),
                account: wallet.address as `0x${string}`,
            });

            // Parse ABI for deposit function
            const abi = parseAbi([
                "function deposit(bytes32 agentId) external payable"
            ]);

            const toastSending = toast.loading("Sending transaction...", { id: txToast });

            const agentId = keccak256(toBytes(escrowContract.depositFunction.agentIdParam));
            // Call the deposit function with agentId using walletClient directly
            const hash = await walletClient.writeContract({
                address: escrowContract.address as `0x${string}`,
                abi,
                functionName: 'deposit',
                args: [agentId],
                value: BigInt(option.value)
            });

            logger.log("Transaction hash:", hash);
            toast.dismiss(toastSending);
            toast.success("Transaction sent! Processing...", { id: txToast });

            // Submit transaction to SDK
            await activeAgent.submitTopUpTransaction({
                txHash: hash,
                walletAddress: wallet.address,
                amountInUSD: option.amountInUSD,
                amountInEth: option.amountInEth,
                creditsToTopUp: option.creditsToTopUp,
            });
            logger.log("submitTopUpTransaction");

            // Get current balance for polling comparison
            const currentBalance = await activeAgent.getBalance({
                walletAddress: wallet.address,
            });
            logger.log(currentBalance, "currentBalance");

            // Poll for balance update
            activeAgent.pollForBalanceUpdate({
                walletAddress: wallet.address,
                initialBalance: currentBalance,
                onConfirmation: (newBalance: UserBalance) => {
                    toast.success("Top-up successful! Balance updated.", { id: txToast });
                    // Invalidate balance query to trigger refetch
                    queryClient.invalidateQueries({ queryKey: ["balance"] });
                    onSuccess(newBalance);
                    setOpen(false);
                },
                onTimeout: () => {
                    toast.error(
                        "Transaction timeout. Please check your balance manually.",
                        {
                            id: txToast,
                        },
                    );
                },
            });
        } catch (error) {
            logger.log("Top-up error:", error);
            toast.error("Top-up failed. See console for details.");
        } finally {
            setProcessingOption(null);
            toast.dismiss();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="rounded-3xl border-black-20 bg-white shadow-lg font-funnel-sans">
                <DialogHeader className="text-left">
                    {feeModelType === "credit-based" ? (
                        <>
                            <DialogTitle className="text-lg font-semibold text-black">
                                Buy Credits
                            </DialogTitle>
                            <DialogDescription className="text-sm text-black-60">
                                Select a package to add credits to your balance.
                            </DialogDescription>
                        </>
                    ) : (
                        <>
                            <DialogTitle className="text-lg font-semibold text-black">
                                Add Funds
                            </DialogTitle>
                            <DialogDescription className="text-sm text-black-60">
                                Select an amount to add to your ETH balance for this agent.
                            </DialogDescription>
                        </>
                    )}
                </DialogHeader>

                <div className="space-y-3">
                    {loading ? (
                        <div className="text-center py-6">
                            <div className="inline-flex items-center gap-2 text-sm text-black-60">
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-black-20 border-t-black-60"></div>
                                Loading options...
                            </div>
                        </div>
                    ) : topUpOptions && topUpOptions.length > 0 ? (
                        <div className="space-y-2">
                            {feeModelType === "credit-based"
                                ? // Credit-Based Agent UI
                                topUpOptions.map((option, index) => (
                                    <div
                                        key={`${option.label}-${option.amountInEth}-${index}`}
                                        className="flex items-center justify-between p-4 border border-black-20 rounded-xl bg-white transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <span className="font-medium text-black text-sm">
                                                {option.label}
                                            </span>
                                            <span className="text-xs text-black-60">
                                                {option.amountInEth ? parseFloat(option.amountInEth).toFixed(5) : 0} ETH
                                            </span>
                                        </div>
                                        <Button
                                            onClick={() => handleTopUp(option)}
                                            disabled={processingOption === option.label}
                                            className="shrink-0 px-4 py-2 text-xs font-medium rounded-3xl bg-black hover:bg-pink group-hover:bg-pink text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
                                        >
                                            {processingOption === option.label
                                                ? "Processing..."
                                                : "Buy"}
                                        </Button>
                                    </div>
                                ))
                                : // Free-Tier Agent UI
                                topUpOptions.map((option, index) => (
                                    <Button
                                        key={`${option.label}-${option.amountInEth}-${index}`}
                                        onClick={() => handleTopUp(option)}
                                        disabled={processingOption === option.label}
                                        className="w-full p-4 text-sm font-medium rounded-xl border border-black-20 bg-white text-black hover:bg-black-5 hover:border-black-30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {processingOption === option.label
                                            ? "Processing..."
                                            : option.label}
                                    </Button>
                                ))}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <span className="text-sm text-black-60">
                                No top-up options available.
                            </span>
                        </div>
                    )}
                </div>

            </DialogContent>
        </Dialog>
    );
}






