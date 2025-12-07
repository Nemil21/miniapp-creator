"use client";

import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableRow
} from "./ui/table";

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  appLink?: string;
  creator?: {
    pfpUrl?: string;
    username?: string;
    displayName?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface DiscoverMiniappsProps {
  projects: Project[];
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getProjectInitial = (name: string) => name.charAt(0).toUpperCase();

export function DiscoverMiniapps({
  projects,
  isLoading,
  isLoadingMore = false,
  hasMore = false,
}: DiscoverMiniappsProps) {
  const discoverableProjects = useMemo(
    () =>
      projects.filter(
        (project) => project.appLink || project.previewUrl || project.vercelUrl
      ),
    [projects]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (discoverableProjects.length === 0) {
    return (
      <div className="py-6 text-center text-base text-gray-500">
        No live miniapps yet. Deploy one to see it here!
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-hidden">
        <Table className="[&_td]:align-top text-sm">
          <TableBody>
            {discoverableProjects.map((project) => {
              const url =
                project.appLink || project.previewUrl || project.vercelUrl || "#";
              const hasUrl = url !== "#";

              return (
                <TableRow key={project.id}>
                  <TableCell className="min-w-0 px-3 sm:px-6">
                    <div className="flex items-center gap-2 sm:gap-3">
                      {project.creator?.pfpUrl ? (
                        <img
                          src={project.creator.pfpUrl}
                          alt={project.name}
                          className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg object-cover flex-shrink-0"
                          width={40}
                          height={40}
                        />
                      ) : null}
                      <div
                        className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ${
                          project.creator?.pfpUrl ? "hidden" : ""
                        }`}
                      >
                        {getProjectInitial(project.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="max-w-[200px] truncate text-sm sm:text-base font-semibold text-gray-900">
                          {project.name}
                        </div>
                        <div className="text-xs sm:text-sm text-gray-500 truncate">
                          {project.appLink
                            ? project.creator?.username || project.creator?.displayName || "Live"
                            : project.previewUrl
                            ? "Preview"
                            : project.vercelUrl
                            ? "Live on Vercel"
                            : "Not deployed"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell px-3 sm:px-6">
                    <span className="text-sm whitespace-nowrap text-gray-500">
                      {formatDate(project.updatedAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right px-3 sm:px-6 w-[80px] sm:w-auto">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center px-4 sm:px-5 py-2 sm:py-2.5 text-sm sm:text-base font-semibold rounded-full transition-colors whitespace-nowrap ${
                        hasUrl
                          ? "bg-black text-white hover:bg-gray-800"
                          : "bg-gray-200 text-gray-400 cursor-not-allowed"
                      }`}
                      onClick={(event) => {
                        if (!hasUrl) {
                          event.preventDefault();
                        }
                      }}
                    >
                      Open
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {isLoadingMore && (
        <div className="flex items-center justify-center py-6 border-t border-gray-200">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
          <span className="ml-3 text-base text-gray-600">Loading more...</span>
        </div>
      )}
      {!hasMore && discoverableProjects.length > 0 && (
        <div className="py-6 text-center text-base text-gray-500 border-t border-gray-200">
          No more miniapps to load
        </div>
      )}
    </>
  );
}
