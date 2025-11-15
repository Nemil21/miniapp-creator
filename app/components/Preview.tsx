"use client";
import { logger } from "../../lib/logger";

import { SignalHighIcon, WifiHighIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Icons } from "./sections/icons";
import { TemplateSelector } from "./TemplateSelector";
import { Iphone } from "./ui/iphone";
import { Safari } from "./ui/safari";

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
  lastUpdated?: number; // Timestamp to track when project was last updated
  appType?: "farcaster" | "web3"; // Which boilerplate was used
}

interface PreviewProps {
  currentProject: GeneratedProject | null;
  selectedAppType?: "farcaster" | "web3";
  onSelectTemplate?: (appType: "farcaster" | "web3") => void;
  reloadTrigger?: number;
}

export function Preview({
  currentProject,
  selectedAppType = "farcaster",
  onSelectTemplate,
  reloadTrigger,
}: PreviewProps) {
  const [iframeError, setIframeError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState<
    "checking" | "ready" | "building" | "error"
  >("checking");
  const [retryCount, setRetryCount] = useState(0);
  const [statusBarTime, setStatusBarTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      setStatusBarTime(new Date());
    }, 60_000);

    return () => clearInterval(id);
  }, []);

  const formattedStatusBarTime = statusBarTime.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Handle manual reload trigger from parent
  useEffect(() => {
    if (reloadTrigger && reloadTrigger > 0) {
      logger.log("🔄 Manual reload requested");
      setIframeKey((prev) => prev + 1);
      setIsLoading(true);
      setIframeError(false);
      // Don't reset deployment status or retry count - just reload the iframe
      // This prevents the deployment check loop
    }
  }, [reloadTrigger]);

  // Check if deployment is ready before loading iframe
  useEffect(() => {
    if (!currentProject?.vercelUrl && !currentProject?.previewUrl) {
      setDeploymentStatus("ready");
      return;
    }

    const previewUrl =
      currentProject.vercelUrl ||
      currentProject.previewUrl ||
      currentProject.url;

    // Skip deployment check for existing projects on initial load ONLY
    // But still check if deploymentStatus is explicitly set to 'checking' (e.g., after edits)
    if (
      currentProject.isNewDeployment === false &&
      deploymentStatus !== "checking"
    ) {
      logger.log(
        `✅ Loading existing project - deployment already ready: ${previewUrl}`
      );
      setDeploymentStatus("ready");
      setRetryCount(0);
      return;
    }

    // For new deployments or after updates, check readiness
    const isAfterUpdate = deploymentStatus === "checking";
    logger.log(
      isAfterUpdate
        ? `🔄 Project updated - checking redeployment readiness: ${previewUrl}`
        : `🆕 New deployment - checking readiness: ${previewUrl}`
    );

    if (!isAfterUpdate) {
      setDeploymentStatus("checking");
      setRetryCount(0);
    }

    const checkDeployment = async () => {
      try {
        logger.log(`🔍 Checking deployment readiness: ${previewUrl}`);

        // Try to fetch the deployment URL with a HEAD request
        await fetch(previewUrl, {
          method: "HEAD",
          mode: "no-cors", // Avoid CORS issues
          cache: "no-cache",
        });

        // With no-cors, we can't check the status, so assume it's ready if no error
        logger.log("✅ Deployment appears to be ready");
        setDeploymentStatus("ready");
      } catch (error) {
        logger.warn(
          `⚠️ Deployment check failed (attempt ${retryCount + 1}):`,
          error
        );

        // Retry up to 5 times with exponential backoff
        if (retryCount < 5) {
          setDeploymentStatus("building");
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Max 10s
          logger.log(`⏳ Retrying in ${delay}ms...`);

          setTimeout(() => {
            setRetryCount((prev) => prev + 1);
          }, delay);
        } else {
          // After 5 attempts, assume it's ready and let the iframe try
          // The iframe error handler will catch it if it's still not ready
          logger.log("⏭️ Max retries reached, attempting to load anyway...");
          setDeploymentStatus("ready");
        }
      }
    };

    checkDeployment();
  }, [
    currentProject?.vercelUrl,
    currentProject?.previewUrl,
    currentProject?.url,
    currentProject?.isNewDeployment,
    retryCount,
    deploymentStatus,
  ]);

  // Force iframe refresh when project is updated (after edits)
  useEffect(() => {
    if (currentProject?.lastUpdated) {
      logger.log(
        "🔄 Project updated, refreshing iframe at:",
        new Date(currentProject.lastUpdated).toISOString()
      );
      setIframeKey((prev) => prev + 1);
      setIsLoading(true);
      setIframeError(false);
      setDeploymentStatus("checking");
      setRetryCount(0);
    }
  }, [currentProject?.lastUpdated]);

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col bg-white overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-4">
          <TemplateSelector
            selectedAppType={selectedAppType}
            onSelectTemplate={onSelectTemplate || (() => {})}
          />
        </div>
      </div>
    );
  }

  // Prioritize vercelUrl over previewUrl over url
  const previewUrl =
    currentProject.vercelUrl || currentProject.previewUrl || currentProject.url;

  // If there's no deployment URL, show a message
  if (!previewUrl) {
    return (
      <div className="h-full flex flex-col bg-white overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <div className="mb-6 flex justify-center">
              <Icons.earnySmallGrayIcon className="w-16 h-16 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-black mb-2">
              No Deployment Yet
            </h3>
            <p className="text-sm text-black-60 mb-6">
              This project hasn&apos;t been deployed yet. Use the chat to make
              changes and deploy your app.
            </p>
            <div className="bg-black-5 rounded-lg p-4 text-left">
              <p className="text-xs text-black-60 font-medium mb-2">💡 Tip:</p>
              <p className="text-xs text-black-60">
                Ask the AI to &quot;deploy this project&quot; or make changes to
                trigger a deployment.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  logger.log("🔍 Preview component - URLs:", {
    vercelUrl: currentProject.vercelUrl,
    previewUrl: currentProject.previewUrl,
    url: currentProject.url,
    selectedUrl: previewUrl,
  });

  const handleIframeError = () => {
    logger.error("Iframe failed to load:", previewUrl);
    setIframeError(true);
    setIsLoading(false);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setIframeError(false);
  };

  // Determine app type - use currentProject.appType if available, otherwise fall back to selectedAppType
  const appType = currentProject.appType || selectedAppType || "farcaster";
  const isFarcaster = appType === "farcaster";

  return (
    <div className="h-full flex flex-col bg-white overflow-y-auto">
      {/* Preview */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative flex flex-col items-center">
          {/* Device Mockup Container */}
          <div
            className="relative"
            style={{
              width: isFarcaster ? "340px" : "800px",
              maxWidth: "90vw",
            }}
          >
            {/* Status Overlays */}
            <div className="absolute inset-0 z-20 pointer-events-none">
              {deploymentStatus === "checking" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 rounded-lg pointer-events-auto">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
                  <div className="text-sm text-gray-600">
                    Checking deployment...
                  </div>
                </div>
              )}
              {deploymentStatus === "building" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 rounded-lg p-4 pointer-events-auto">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
                  <div className="text-sm font-semibold text-gray-900 mb-1">
                    Deployment Building...
                  </div>
                  <div className="text-xs text-gray-600 text-center mb-3">
                    Your app is being deployed to Vercel. This usually takes 1-2
                    minutes.
                  </div>
                  <div className="text-xs text-gray-500">
                    Attempt {retryCount + 1} of 5
                  </div>
                </div>
              )}
              {isLoading && !iframeError && deploymentStatus === "ready" && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/95 rounded-lg pointer-events-auto">
                  <div className="text-sm text-gray-600">
                    Loading preview...
                  </div>
                </div>
              )}
              {iframeError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/95 rounded-lg p-4 pointer-events-auto">
                  <div className="text-sm text-red-600 mb-2 text-center font-semibold">
                    Preview blocked by deployment
                  </div>
                  <div className="text-xs text-gray-600 mb-1 text-center">
                    The deployed app refused iframe embedding
                  </div>
                  <div className="text-xs text-gray-400 mb-4 text-center break-all px-2">
                    {previewUrl}
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 max-w-[280px]">
                    <p className="text-xs text-blue-800 mb-2">
                      💡 <strong>Why this happens:</strong>
                    </p>
                    <p className="text-xs text-blue-700">
                      Vercel deployments block iframe embedding for security.
                      The app needs to be redeployed with updated security
                      headers.
                    </p>
                  </div>
                  <button
                    onClick={() => window.open(previewUrl, "_blank")}
                    className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 font-medium mb-2"
                  >
                    Open in New Tab
                  </button>
                  <button
                    onClick={() => {
                      setIframeError(false);
                      setIsLoading(true);
                      setIframeKey((prev) => prev + 1);
                      setDeploymentStatus("checking");
                      setRetryCount(0);
                    }}
                    className="px-3 py-1 text-gray-600 text-xs rounded hover:text-black"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>

            {/* Device Mockup with Iframe */}
            {deploymentStatus === "ready" &&
              (isFarcaster ? (
                // iPhone mockup for Farcaster apps
                <div className="relative">
                  {/* Iframe positioned to show through iPhone's screen area */}
                  <div
                    className="absolute z-0 overflow-hidden"
                    style={{
                      left: "4.9%",
                      top: "2.2%",
                      width: "90%",
                      height: "95.6%",
                      borderRadius: "6.5% / 6.5%",
                    }}
                  >
                    <div className="flex items-center justify-between px-4 py-2 text-[11px] font-semibold text-black/90 z-10 pointer-events-none">
                      <span>{formattedStatusBarTime}</span>
                        <div className="flex items-center justify-center gap-1">
                          <SignalHighIcon strokeWidth={2.75} size={12} className="text-black/80 mb-[2px]" />
                          <WifiHighIcon strokeWidth={2.75} size={12} className="text-black/80 mb-[2px]" />
                        {/* battery */}
                        <div className="flex items-center gap-[0.67px]">
                          <div className="w-4 h-2 border-[0.67px] border-black/80 rounded-[2px] relative">
                            <div className="absolute inset-[0.5px] rounded-[1.5px] bg-black/80" />
                          </div>
                          <div className="w-0.5 h-1 border border-black/80 rounded-r-sm" />
                        </div>
                      </div>
                    </div>

                    <iframe
                      key={`${currentProject.projectId}-${iframeKey}`}
                      src={previewUrl}
                      className="w-full h-full border-0 pb-6 bg-white"
                      title="Generated App Preview"
                      allow="fullscreen; camera; microphone; gyroscope; accelerometer; geolocation; clipboard-write; autoplay"
                      data-origin={previewUrl}
                      data-v0="true"
                      loading="eager"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups-to-escape-sandbox allow-pointer-lock allow-popups allow-modals allow-orientation-lock allow-presentation"
                      onError={handleIframeError}
                      onLoad={handleIframeLoad}
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                      }}
                    />
                  </div>
                  {/* iPhone frame overlays with transparent screen area (mask applied internally) */}
                  <Iphone
                    src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                    className="w-full relative pointer-events-none"
                  />
                </div>
              ) : (
                // Safari mockup for Web3 apps
                <div className="relative">
                  {/* Iframe positioned to show through Safari's screen area */}
                  <div
                    className="absolute z-0 overflow-hidden"
                    style={{
                      left: "0.08%",
                      top: "6.9%",
                      width: "99.75%",
                      height: "93%",
                      borderRadius: "0 0 11px 11px",
                    }}
                  >
                    <iframe
                      key={`${currentProject.projectId}-${iframeKey}`}
                      src={previewUrl}
                      className="w-full h-full border-0 bg-white"
                      title="Generated App Preview"
                      allow="fullscreen; camera; microphone; gyroscope; accelerometer; geolocation; clipboard-write; autoplay"
                      data-origin={previewUrl}
                      data-v0="true"
                      loading="eager"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups-to-escape-sandbox allow-pointer-lock allow-popups allow-modals allow-orientation-lock allow-presentation"
                      onError={handleIframeError}
                      onLoad={handleIframeLoad}
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                      }}
                    />
                  </div>
                  {/* Safari frame overlays with transparent screen area (mask applied internally) */}
                  <Safari
                    url={previewUrl}
                    imageSrc="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                    className="w-full relative pointer-events-none"
                  />
                </div>
              ))}
          </div>

          {/* Label */}
          <div className="mt-4 text-xs text-black-60">
            {isFarcaster ? "Farcaster Mini App Preview" : "Web3 App Preview"}
          </div>
          {previewUrl && (
            <div className="mt-1 text-xs text-gray-500 text-center max-w-md truncate">
              {previewUrl}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
