"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "./ui/button";

export default function WalletButton() {
    const { ready, authenticated, login, createWallet } = usePrivy();
    const { wallets } = useWallets();

    console.log('🔐 WalletButton render:', { ready, authenticated, walletsCount: wallets.length });

    if (!ready) {
        return (
            <Button
                variant="outline"
                size="sm"
                disabled
                className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 rounded-3xl"
            >
                Loading...
            </Button>
        );
    }

    if (!authenticated) {
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={login}
                className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer rounded-3xl"
            >
                Connect Wallet
            </Button>
        );
    }

    // User is authenticated but has no wallet - show create wallet button
    if (wallets.length === 0) {
        return (
            <Button
                variant="outline"
                size="sm"
                onClick={createWallet}
                className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer rounded-3xl"
            >
                Connect Wallet
            </Button>
        );
    }

    // User has wallet, show nothing (BalanceDisplay will show instead)
    return null;
}


