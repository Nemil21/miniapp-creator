'use client';

import { use, useEffect } from 'react';
import HomeContent from '@/components/HomeContent';
import ProtectedRoute from '@/components/ProtectedRoute';
import { AuthProvider } from '@/contexts/AuthContext';
import { useProjectStore } from '@/store/useProjectStore';

interface ProjectPageParams {
  projectId: string;
}

interface ProjectPageProps {
  params: Promise<ProjectPageParams>;
}

function ProjectPageContent({ paramsPromise }: { paramsPromise: Promise<ProjectPageParams> }) {
  const { setSelectedProjectId } = useProjectStore();
  const { projectId } = use(paramsPromise);

  useEffect(() => {
    setSelectedProjectId(projectId);
  }, [projectId, setSelectedProjectId]);

  return <HomeContent />;
}

export default function ProjectPage({ params }: ProjectPageProps) {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <ProjectPageContent paramsPromise={params} />
      </ProtectedRoute>
    </AuthProvider>
  );
}

