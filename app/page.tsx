'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import ProtectedRoute from '@/components/ProtectedRoute';
import { AuthProvider } from '@/contexts/AuthContext';
import HomeContent from '@/components/HomeContent';

export default function Home() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <HomeContent />
      </ProtectedRoute>
    </AuthProvider>
  );
}
