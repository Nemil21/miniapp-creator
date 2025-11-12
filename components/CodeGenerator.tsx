"use client";
import { logger } from "@/lib/logger";

import { useState } from "react";
import { CodeEditorAndPreview } from "./CodeEditorAndPreview";
import { PublishModal } from "./PublishModal";
import TopUpDialog from "./top-up-dialog";
import { useAuthContext } from "@/contexts/AuthContext";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import type { EarnKit } from "@earnkit/earn";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { Rocket } from "lucide-react";
import BalanceDisplay from "./BalanceDisplay";

interface GeneratedProject {
  projectId: string;
  port: number;
  url: string;
  generatedFiles?: string[];
  previewUrl?: string;
  vercelUrl?: string;
  aliasSuccess?: boolean;
  isNewDeployment?: boolean;
  hasPackageChanges?: boolean;
}

interface CodeGeneratorProps {
  currentProject: GeneratedProject | null;
  isGenerating?: boolean;
  isProjectLoading?: boolean;
  activeAgent?: EarnKit;
  feeModelType?: "free-tier" | "credit-based";
}

export function CodeGenerator({
  currentProject,
  isGenerating = false,
  isProjectLoading = false,
  activeAgent,
  feeModelType,
}: CodeGeneratorProps) {
  const { sessionToken } = useAuthContext();
  const [viewMode, setViewMode] = useState<"code" | "preview">("preview");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // For balance display
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const walletAddress = wallets[0]?.address;

  // Get balance data
  const { data: balance } = useQuery({
    queryKey: ["balance", "credit-based", walletAddress],
    queryFn: async () => {
      if (!walletAddress || !activeAgent)
        throw new Error("Wallet not connected");
      return activeAgent.getBalance({ walletAddress });
    },
    enabled: !!walletAddress && !!activeAgent && privyReady && authenticated,
    placeholderData: { eth: "0", credits: "0" },
    staleTime: 1000 * 30,
  });

  const handleTopUpSuccess = () => {
    // Handle successful top up - balance will refresh automatically
    console.log("Top up successful!");
  };

  logger.log("🎨 CodeGenerator render:", {
    hasActiveAgent: !!activeAgent,
    feeModelType,
    shouldShowBalance: !!(activeAgent && feeModelType),
  });

  const getViewModeIcon = (mode: "code" | "preview") => {
    switch (mode) {
      case "code":
        return (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
        );
      case "preview":
        return (
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
        );
    }
  };

  const getLinkIcon = () => (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  );

  const getCopyIcon = () => (
    <svg
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );

  const getExternalIcon = () => (
    <svg
      className="w-3 h-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );

  const handleCopyLink = async () => {
    if (!currentProject?.url) return;

    try {
      await navigator.clipboard.writeText(currentProject.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy link:", error);
    }
  };

  const handleOpenInNewTab = () => {
    if (!currentProject?.url) return;
    window.open(currentProject.url, "_blank");
  };

  return (
    <div className="h-full flex-1 w-full flex flex-col bg-gray-50">
      <div className="sticky top-0 left-0 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        {/* Left side - View toggle buttons */}
        <div className="flex items-center gap-3">
          <Tabs
            value={viewMode}
            onValueChange={(value) => setViewMode(value as "code" | "preview")}
            className="w-full"
          >
            <TabsList className="p-1">
              <TabsTrigger value="code" title="Code view">
                {getViewModeIcon("code")}
                <span className="capitalize">code</span>
              </TabsTrigger>
              <TabsTrigger value="preview" title="Preview view">
                {getViewModeIcon("preview")}
                <span className="capitalize">preview</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* <div className="flex items-center gap-2">
            <Icons.earnySmallGrayIcon className="w-5 h-5 text-gray-400" />
            <span className="text-lg font-funnel-display text-black font-medium">Miniapp Preview</span>
          </div> */}
        </div>

        {/* Right side - Link Actions, Publish Button & Balance Display */}
        <div className="flex items-center gap-3">
          {/* Link Display with Actions - Show when project exists */}
          <BalanceDisplay
            activeAgent={activeAgent || (undefined as unknown as EarnKit)}
            feeModelType={feeModelType || "credit-based"}
          />
          {currentProject?.url && (
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
              {/* Link Icon */}
              <div className="text-gray-500">{getLinkIcon()}</div>

              {/* URL Display */}
              <div className="text-sm text-gray-700 font-mono max-w-[200px] truncate">
                {currentProject.url.replace(/^https?:\/\//, "")}
              </div>
              {/* Action Buttons */}
              <div className="flex items-center gap-1 ml-2">
                {/* Copy Link Button */}
                <Button
                  onClick={handleCopyLink}
                  variant="ghost"
                  size="icon"
                  className={`p-1.5 rounded-md transition-colors ${
                    linkCopied
                      ? "bg-green-100 text-green-700"
                      : "text-gray-600 hover:text-black hover:bg-gray-200"
                  }`}
                  title="Copy link"
                >
                  {getCopyIcon()}
                </Button>

                {/* Open in New Tab Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenInNewTab}
                  className="p-1.5 rounded-md transition-colors text-gray-600 hover:text-black hover:bg-gray-200"
                  title="Open in new tab"
                >
                  {getExternalIcon()}
                </Button>
              </div>
            </div>
          )}

          {/* Balance & Top Up - Show when credit system is available */}
          {activeAgent && feeModelType && (
            <div className="flex items-center gap-3">
              {/* Balance Display */}
              <div className="text-sm text-gray-600">
                {walletAddress ? (
                  <span>
                    Balance:{" "}
                    {balance ? `${balance.credits} Credits` : "0 Credits"}
                  </span>
                ) : (
                  <span>Balance: Not connected</span>
                )}
              </div>

              {/* Top Up Button */}
              <TopUpDialog
                activeAgent={activeAgent}
                feeModelType={feeModelType}
                onSuccess={handleTopUpSuccess}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2"
                  title="Top Up Credits"
                >
                  Top Up
                </Button>
              </TopUpDialog>
            </div>
          )}

          {/* Publish Button - Always show */}
          <Button
            variant="default"
            onClick={() => (currentProject ? setShowPublishModal(true) : null)}
            disabled={!currentProject}
            title={
              currentProject ? "Publish to Farcaster" : "No project loaded"
            }
          >
            <Rocket className="w-4 h-4" />
            <span>Publish</span>
          </Button>
        </div>
      </div>
      <CodeEditorAndPreview
        currentProject={currentProject}
        isGenerating={isGenerating}
        isLoading={isProjectLoading}
        viewMode={viewMode}
        onFileChange={(filePath, content) => {
          logger.log("File changed:", filePath, content.substring(0, 100));
        }}
        onSaveFile={async (filePath, content) => {
          if (!currentProject || !sessionToken) return false;
          try {
            const response = await fetch("/api/files", {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sessionToken}`,
              },
              body: JSON.stringify({
                projectId: currentProject.projectId,
                filename: filePath,
                content,
              }),
            });
            return response.ok;
          } catch (error) {
            logger.error("Failed to save file:", error);
            return false;
          }
        }}
      />

      {/* Publish Modal */}
      <PublishModal
        isOpen={showPublishModal}
        onClose={() => setShowPublishModal(false)}
        projectUrl={currentProject?.url}
        projectId={currentProject?.projectId}
      />
    </div>
  );
}
