"use client";
import { logger } from "@/lib/logger";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Icons } from "./sections/icons";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

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
}

interface PreviewProps {
  currentProject: GeneratedProject | null;
}

export function Preview({ currentProject }: PreviewProps) {
  const [iframeError, setIframeError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    () => {
      // Default to "farcaster-miniapp" if no template is stored
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("minidev_selected_template");
        return stored || "farcaster-miniapp";
      }
      return "farcaster-miniapp";
    }
  );

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
    }
  }, [currentProject?.lastUpdated]);

  useEffect(() => {
    if (currentProject) {
      setSelectedTemplateId(null);
      // Clear template ID from localStorage when project is loaded
      if (typeof window !== "undefined") {
        localStorage.removeItem("minidev_selected_template");
      }
    } else {
      // When no project, ensure default template is set
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("minidev_selected_template");
        if (!stored) {
          localStorage.setItem("minidev_selected_template", "farcaster-miniapp");
          setSelectedTemplateId("farcaster-miniapp");
        } else {
          // Sync state with localStorage
          setSelectedTemplateId(stored);
        }
      }
    }
  }, [currentProject]);

  if (!currentProject) {
    const templateOptions = [
      {
        id: "farcaster-miniapp",
        title: "Farcaster Miniapp",
        description: "Launch a Farcaster miniapp with onchain actions.",
        logo: "/farcaster.svg",
        prompt:
          "Help me build a Farcaster miniapp. I want a Farcaster miniapp with onchain actions.",
      },
      {
        id: "base-webapp",
        title: "Web3 App",
        description:
          "Spin up a Base-connected web experience that works great on desktop and mobile.",
        logo: "/base-logo.svg",
        prompt:
          "Help me build a Base web app. I want a responsive site that lets users connect a wallet and interact with Base onchain data.",
      },
    ] as const;

    const handleTemplateSelect = (prompt: string) => {
      if (typeof window === "undefined") {
        return;
      }
      const event = new CustomEvent("templateSelect", { detail: prompt });
      window.dispatchEvent(event);
    };

    return (
      <div className="h-full flex flex-col justify-center items-center bg-white overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <div className="mb-6 flex justify-center">
              <Icons.earnySmallGrayIcon className="w-16 h-16 text-gray-200" />
            </div>
            <h3 className="text-2xl font-semibold text-black text-center">
              Choose Your Build
            </h3>
            <p className="mt-2 text-sm text-black-60 text-center">
              Select a app template to start building your web3 app.
            </p>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {templateOptions.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    // Store template ID in localStorage for ChatInterface to use
                    if (typeof window !== "undefined") {
                      localStorage.setItem(
                        "minidev_selected_template",
                        template.id
                      );
                    }
                    handleTemplateSelect(template.prompt);
                  }}
                  className={`group flex flex-col h-full rounded-2xl border p-5 text-left shadow-sm transition-all focus:outline-none ring-0 focus:ring-2 focus:ring-black/30 ${
                    selectedTemplateId === template.id
                      ? "border-black bg-black text-white shadow-lg"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                          selectedTemplateId === template.id
                            ? "bg-white/10"
                            : "bg-gray-50"
                        }`}
                      >
                        <Image
                          src={template.logo}
                          alt={`${template.title} logo`}
                          width={32}
                          height={32}
                          className={`h-8 w-8 ${
                            selectedTemplateId === template.id &&
                            template.title === "Web3 App"
                              ? "brightness-0 invert"
                              : ""
                          }`}
                        />
                      </div>
                      <div>
                        <h4
                          className={`text-base font-semibold ${
                            selectedTemplateId === template.id
                              ? "text-white"
                              : "text-black"
                          }`}
                        >
                          {template.title}
                        </h4>
                      </div>
                    </div>
                    {selectedTemplateId === template.id ? (
                      <CheckIcon className="h-5 w-5 text-white" />
                    ) : (
                      <ChevronRightIcon className="h-5 w-5 text-black" />
                    )}
                  </div>
                  <p
                    className={`mt-4 flex-1 text-sm ${
                      selectedTemplateId === template.id
                        ? "text-white/80"
                        : "text-black-60"
                    }`}
                  >
                    {template.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
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

  return (
    <div className="h-full flex flex-col bg-white overflow-y-auto">
      {/* Mobile Preview */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative flex flex-col items-center">
          {/* iPhone frame */}
          <div className="bg-black rounded-[40px] shadow-2xl p-2 border-4 border-gray-800 relative">
            {isLoading && !iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white rounded-[32px] z-10">
                <div className="text-sm text-gray-600">Loading preview...</div>
              </div>
            )}
            {iframeError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-[32px] z-10 p-4">
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
                    Vercel deployments block iframe embedding for security. The
                    app needs to be redeployed with updated security headers.
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
                  }}
                  className="px-3 py-1 text-gray-600 text-xs rounded hover:text-black"
                >
                  Retry
                </button>
              </div>
            )}
            <iframe
              key={`${currentProject.projectId}-${iframeKey}`}
              src={previewUrl}
              className="w-full h-full rounded-[32px] border-0 bg-white"
              title="Generated App Preview"
              allow="fullscreen; camera; microphone; gyroscope; accelerometer; geolocation; clipboard-write; autoplay"
              data-origin={previewUrl}
              data-v0="true"
              loading="eager"
              sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups-to-escape-sandbox allow-pointer-lock allow-popups allow-modals allow-orientation-lock allow-presentation"
              onError={handleIframeError}
              onLoad={handleIframeLoad}
              style={{
                width: 320,
                height: 600, // iPhone 12/13/14 aspect ratio
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            />
          </div>
          <div className="mt-2 text-xs text-black-60">Mobile Preview</div>
          {previewUrl && (
            <div className="mt-1 text-xs text-gray-500 text-center max-w-xs truncate">
              {previewUrl}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
