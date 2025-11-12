'use client';

import { create } from 'zustand';

export interface GeneratedProject {
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

interface ProjectStoreState {
  selectedProjectId: string | null;
  currentProject: GeneratedProject | null;
  setSelectedProjectId: (projectId: string | null) => void;
  setCurrentProject: (project: GeneratedProject | null) => void;
  resetProjectState: () => void;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  selectedProjectId: null,
  currentProject: null,
  setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),
  setCurrentProject: (project) => set({ currentProject: project }),
  resetProjectState: () => set({ selectedProjectId: null, currentProject: null }),
}));

