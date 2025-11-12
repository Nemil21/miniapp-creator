'use client';

import { useMemo } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Project {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  vercelUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface DiscoverMiniappsProps {
  projects: Project[];
  isLoading: boolean;
}

const formatDate = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getProjectInitial = (name: string) => name.charAt(0).toUpperCase();

export function DiscoverMiniapps({ projects, isLoading }: DiscoverMiniappsProps) {
  const discoverableProjects = useMemo(
    () => projects.filter((project) => project.previewUrl || project.vercelUrl),
    [projects],
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
      <div className="py-6 text-center text-sm text-gray-500">
        No live miniapps yet. Deploy one to see it here!
      </div>
    );
  }

  return (
    <Table className="[&_td]:align-top text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>Miniapp</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="text-right"> </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {discoverableProjects.map((project) => {
          const url = project.previewUrl || project.vercelUrl || '#';
          const hasUrl = url !== '#';
          return (
            <TableRow key={project.id}>
              <TableCell>
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white text-xs font-semibold">
                    {getProjectInitial(project.name)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900 truncate">{project.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {project.previewUrl ? 'Preview' : project.vercelUrl ? 'Live on Vercel' : 'Not deployed'}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <p className="text-xs text-gray-600 line-clamp-2">
                  {project.description || 'No description provided.'}
                </p>
              </TableCell>
              <TableCell>
                <span className="text-[11px] text-gray-500">{formatDate(project.updatedAt)}</span>
              </TableCell>
              <TableCell className="text-right">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                    hasUrl ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  onClick={(event) => {
                    if (!hasUrl) {
                      event.preventDefault();
                    }
                  }}
                >
                  Try
                </a>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

