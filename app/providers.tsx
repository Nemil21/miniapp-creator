'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 1000 * 60, // 1 minute
                retry: 1,
            },
        },
    }));

    return (
        <QueryClientProvider client={queryClient}>
            <PrivyProvider
                appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
                clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || ''}
                config={{
                    // Login methods - prioritize external wallets
                    loginMethods: ['wallet', 'email', 'sms'],
                    // Create embedded wallets only if explicitly requested
                    embeddedWallets: {
                        ethereum: {
                            createOnLogin: 'off'  // Changed from 'users-without-wallets' to 'off'
                        }
                    },
                    // Require wallet connection
                    appearance: {
                        showWalletLoginFirst: true
                    }
                }}
            >
                {children}
                <Toaster
                    position="top-right"
                    toastOptions={{
                        duration: 4000,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                    }}
                />
            </PrivyProvider>
        </QueryClientProvider>
    );
}