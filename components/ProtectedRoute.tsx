'use client';

import { useAuthContext } from '@/contexts/AuthContext';
import { EmailLogin } from './EmailLogin';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuthContext();

    if (isLoading) return (
        <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
            {/* Background with grid pattern inspired by home page */}
            <div className="absolute inset-0 bg-[#0A0B1A]"></div>
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:25px_25px]"></div>

            <div className="animate-spin h-8 w-8 border-2 border-white border-t-transparent rounded-full"></div>
        </div>
    );

    if (!isAuthenticated) {
        return (
            <EmailLogin />
        );
    }

    return <>{children}</>;
}
