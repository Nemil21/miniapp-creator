'use client';
import { logger } from "../../lib/logger";


import { useEffect, useState, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

interface AuthState {
  isAuthenticated: boolean;
  sessionToken: string | null;
  user: {
    id: string;
    privyUserId: string;
    email?: string;
    displayName?: string;
    pfpUrl?: string;
  } | null;
  isLoading: boolean;
}

export function useAuth() {
  const { ready, authenticated, user: privyUser, getAccessToken, logout } = usePrivy();
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    sessionToken: null,
    user: null,
    isLoading: true,
  });
  // const [isInitializing, setIsInitializing] = useState(false);
  const hasInitialized = useRef(false);
  const initializationPromise = useRef<Promise<void> | null>(null);

  // Function to handle session expiration
  const handleSessionExpired = async () => {
    logger.log('🔄 Session expired, logging out and redirecting to login');
    setAuthState({
      isAuthenticated: false,
      sessionToken: null,
      user: null,
      isLoading: false,
    });
    hasInitialized.current = false;
    initializationPromise.current = null;
    
    // Logout from Privy
    await logout();
    
    // Redirect to login page
    router.push('/');
  };

  useEffect(() => {
    const initializeAuth = async () => {
      if (!ready) {
        setAuthState(prev => ({ ...prev, isLoading: true }));
        return;
      }

      if (!authenticated || !privyUser) {
        setAuthState({
          isAuthenticated: false,
          sessionToken: null,
          user: null,
          isLoading: false,
        });
        hasInitialized.current = false; // Reset for next login
        initializationPromise.current = null; // Reset promise
        return;
      }

      // If we already have a valid session and it's the same user, don't re-authenticate
      if (authState.isAuthenticated && authState.sessionToken && authState.user?.privyUserId === privyUser.id) {
        logger.log('✅ Already authenticated with valid session, skipping re-authentication');
        hasInitialized.current = true;
        return;
      }

      // If already initializing, wait for the existing promise
      if (initializationPromise.current) {
        await initializationPromise.current;
        return;
      }

      // Create a new initialization promise
      initializationPromise.current = (async () => {
      try {
        // Get Privy access token
        const accessToken = await getAccessToken();
        
        // Create or get user in our backend system
        const response = await fetch('/api/auth/privy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            privyUserId: privyUser.id,
            email: privyUser.email?.address,
            displayName: privyUser.email?.address || 'User',
            pfpUrl: undefined,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setAuthState({
            isAuthenticated: true,
            sessionToken: data.sessionToken,
            user: data.user,
            isLoading: false,
          });
          hasInitialized.current = true;
        } else {
          const errorText = await response.text();
          logger.error('❌ Failed to create user session:', errorText);
          setAuthState({
            isAuthenticated: false,
            sessionToken: null,
            user: null,
            isLoading: false,
          });
        }
      } catch (error) {
        logger.error('Authentication error:', error);
        setAuthState({
          isAuthenticated: false,
          sessionToken: null,
          user: null,
          isLoading: false,
        });
      } finally {
        // setIsInitializing(false);
        initializationPromise.current = null;
      }
      })();

      await initializationPromise.current;
    };

    initializeAuth();
  }, [ready, authenticated, privyUser?.id, getAccessToken, privyUser, authState.isAuthenticated, authState.sessionToken, authState.user?.privyUserId, logout, router]);

  return {
    ...authState,
    handleSessionExpired,
  };
}
