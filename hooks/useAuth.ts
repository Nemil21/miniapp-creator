'use client';
import { logger } from "@/lib/logger";


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

      // Check if linkedAccounts have changed (e.g., Farcaster was linked/unlinked)
      const farcasterAccount = privyUser.linkedAccounts?.find(
        (account) => account.type === 'farcaster'
      ) as { type: string; displayName?: string; username?: string; pfp?: string } | undefined;
      const hasFarcaster = !!farcasterAccount;
      const newDisplayName = farcasterAccount?.displayName || farcasterAccount?.username;
      const newPfpUrl = farcasterAccount?.pfp;
      
      console.log('🔄 [useAuth] Checking if re-auth needed:', {
        hasFarcaster,
        newDisplayName,
        newPfpUrl,
        currentDisplayName: authState.user?.displayName,
        currentPfpUrl: authState.user?.pfpUrl,
        linkedAccountsCount: privyUser.linkedAccounts?.length
      });

      // If we already have a valid session and it's the same user, check if Farcaster data changed
      if (authState.isAuthenticated && authState.sessionToken && authState.user?.privyUserId === privyUser.id) {
        // If Farcaster was just linked/unlinked or data changed, re-authenticate
        const farcasterDataChanged = 
          (hasFarcaster && (authState.user?.displayName !== newDisplayName || authState.user?.pfpUrl !== newPfpUrl)) ||
          (!hasFarcaster && (authState.user?.displayName !== privyUser.email?.address));
        
        if (farcasterDataChanged) {
          console.log('🔄 [useAuth] Farcaster data changed, re-authenticating...');
          hasInitialized.current = false; // Force re-initialization
          // Continue to re-authenticate
        } else {
          logger.log('✅ Already authenticated with valid session, skipping re-authentication');
          hasInitialized.current = true;
          return;
        }
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
        
        // Extract Farcaster data if available
        console.log('🔍 [useAuth] Checking for Farcaster account...');
        console.log('🔍 [useAuth] privyUser.linkedAccounts:', privyUser.linkedAccounts?.map((acc) => ({ 
          type: acc.type
        })));
        
        const farcasterAccount = privyUser.linkedAccounts?.find(
          (account) => account.type === 'farcaster'
        ) as { type: string; displayName?: string; username?: string; pfp?: string; fid?: number } | undefined;

        const displayName = farcasterAccount?.displayName 
          || farcasterAccount?.username 
          || privyUser.email?.address 
          || 'User';

        const pfpUrl = farcasterAccount?.pfp || undefined;
        
        console.log('📝 [useAuth] Extracted Farcaster data:', {
          hasFarcasterAccount: !!farcasterAccount,
          displayName,
          pfpUrl,
          fid: farcasterAccount?.fid
        });
        
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
            displayName,
            pfpUrl,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ [useAuth] Backend response:', {
            user: data.user,
            hasSessionToken: !!data.sessionToken
          });
          console.log('✅ [useAuth] Setting authState with user:', {
            displayName: data.user.displayName,
            pfpUrl: data.user.pfpUrl,
            email: data.user.email
          });
          setAuthState({
            isAuthenticated: true,
            sessionToken: data.sessionToken,
            user: data.user,
            isLoading: false,
          });
          console.log('✅ [useAuth] authState set successfully');
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
  }, [ready, authenticated, privyUser?.id, privyUser?.linkedAccounts?.length, getAccessToken, privyUser, authState.isAuthenticated, authState.sessionToken, authState.user?.privyUserId, authState.user?.displayName, authState.user?.pfpUrl, logout, router]);

  return {
    ...authState,
    handleSessionExpired,
  };
}
