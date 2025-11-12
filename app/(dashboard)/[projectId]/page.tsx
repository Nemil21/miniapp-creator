"use client";

import HomeContent from "@/components/HomeContent";
import { useProjectStore } from "@/store/useProjectStore";
import { use, useEffect } from "react";

interface ProjectPageParams {
  projectId: string;
}

interface ProjectPageProps {
  params: Promise<ProjectPageParams>;
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { setSelectedProjectId } = useProjectStore();
  const { projectId } = use(params);

  useEffect(() => {
    setSelectedProjectId(projectId);
  }, [projectId, setSelectedProjectId]);

  return <HomeContent />;
}
