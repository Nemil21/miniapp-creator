'use client';

import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from '@/lib/apiUtils';
import { useAuthContext } from '@/contexts/AuthContext';
import { useProjectStore, GeneratedProject } from '@/store/useProjectStore';

const transformProject = (projectData: {
  id: string;
  previewUrl?: string;
  vercelUrl?: string;
  files: { filename: string }[];
}): GeneratedProject => ({
  projectId: projectData.id,
  port: 3000,
  url: projectData.vercelUrl || projectData.previewUrl || '',
  generatedFiles: projectData.files?.map((file) => file.filename) || [],
  previewUrl: projectData.previewUrl,
  vercelUrl: projectData.vercelUrl,
  aliasSuccess: !!(projectData.vercelUrl || projectData.previewUrl),
  isNewDeployment: false,
  hasPackageChanges: false,
});

export const useProjectData = () => {
  const { apiCall } = useApiUtils();
  const { sessionToken } = useAuthContext();
  const queryClient = useQueryClient();
  const { selectedProjectId, setCurrentProject } = useProjectStore();

  const fetchProjectById = useCallback(
    async (projectId: string) => {
      const data = await apiCall<{
        project: {
          id: string;
          previewUrl?: string;
          vercelUrl?: string;
          files: { filename: string }[];
          chatMessages: unknown[];
        };
      }>(`/api/projects/${projectId}`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      const projectData = data.project;
      const generatedProject = transformProject(projectData);

      return generatedProject;
    },
    [apiCall, sessionToken]
  );

  const { data, isFetching } = useQuery<GeneratedProject>({
    queryKey: ['project', selectedProjectId],
    queryFn: () => {
      if (!selectedProjectId) {
        throw new Error('No project selected');
      }
      return fetchProjectById(selectedProjectId);
    },
    enabled: !!selectedProjectId && !!sessionToken,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    initialData: () => {
      if (!selectedProjectId) return undefined;
      return queryClient.getQueryData<GeneratedProject>(['project', selectedProjectId]);
    },
  });

  useEffect(() => {
    if (data) {
      setCurrentProject(data);
    }
  }, [data, setCurrentProject]);

  useEffect(() => {
    if (!selectedProjectId) {
      setCurrentProject(null);
    }
  }, [selectedProjectId, setCurrentProject]);

  return {
    fetchedProject: data,
    isProjectLoading: isFetching,
    fetchProjectById,
  };
};

