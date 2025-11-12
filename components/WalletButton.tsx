"use client";
import { logger } from "@/lib/logger";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Button } from "./ui/button";
import { Wallet } from "lucide-react";

export default function WalletButton() {
  const { ready, authenticated, login, linkWallet } = usePrivy();
  const { wallets } = useWallets();

  // Check if user only has embedded wallet
  const hasOnlyEmbeddedWallet =
    wallets.length > 0 && wallets.every((w) => w.walletClientType === "privy");
  const hasExternalWallet = wallets.some(
    (w) =>
      w.walletClientType === "metamask" ||
      w.walletClientType === "coinbase_wallet" ||
      w.walletClientType === "rainbow" ||
      w.walletClientType === "wallet_connect"
  );

  logger.log("🔐 WalletButton render:", {
    ready,
    authenticated,
    walletsCount: wallets.length,
    hasOnlyEmbeddedWallet,
    hasExternalWallet,
    walletTypes: wallets.map((w) => w.walletClientType),
  });

  if (!ready) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60"
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
        className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer"
      >
        <Wallet className="size-3.5" />
        Connect Wallet
      </Button>
    );
  }

  // User is authenticated but has no wallet - show connect wallet button
  if (wallets.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={linkWallet}
        className="px-3 py-1.5 text-xs font-medium border-black-20 text-black-60 hover:text-black hover:border-black-30 hover:bg-black-5 transition-colors cursor-pointer"
      >
        <Wallet className="size-3.5" />
        Connect Wallet
      </Button>
    );
  }

  // User has only embedded wallet - show option to link external wallet
  if (hasOnlyEmbeddedWallet && !hasExternalWallet) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={linkWallet}
        className="px-3 py-1.5 text-xs font-medium text-black-60 transition-colors cursor-pointer"
        title="Currently using temporary wallet. Click to connect your own wallet"
      >
        <Wallet className="size-3.5" />
        Connect Wallet
      </Button>
    );
  }

  // User has external wallet, show nothing (BalanceDisplay will show instead)
  return null;
}
