'use client';

import { createContext, ReactNode, useContext } from 'react';

interface SidebarContextValue {
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export function SidebarProvider({
  children,
  toggleSidebar,
}: {
  children: ReactNode;
  toggleSidebar: () => void;
}) {
  return (
    <SidebarContext.Provider value={{ toggleSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebarContext() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }
  return context;
}

