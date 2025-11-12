'use client';

import { ReactNode, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HoverSidebar, HoverSidebarRef } from '@/components/HoverSidebar';
import { useProjectStore } from '@/store/useProjectStore';
import { SidebarProvider } from '@/components/SidebarContext';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const sidebarRef = useRef<HoverSidebarRef>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { setSelectedProjectId, resetProjectState } = useProjectStore();
  const router = useRouter();

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);

  return (
    <SidebarProvider toggleSidebar={toggleSidebar}>
      <div className="flex min-h-screen h-screen font-funnel-sans bg-white">
        <HoverSidebar
          ref={sidebarRef}
          isOpen={isSidebarOpen}
          onToggle={toggleSidebar}
          onNewProject={() => {
            resetProjectState();
            router.push('/', { scroll: false });
          }}
          onProjectSelect={(project) => {
            setSelectedProjectId(project.id);
            router.push(`/${project.id}`, { scroll: false });
          }}
        />
        <div className="flex-1 min-h-screen overflow-hidden bg-gray-50">
          {children}
        </div>
      </div>
    </SidebarProvider>
  );
}

