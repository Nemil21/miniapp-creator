import { logger } from "./logger";
import { useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * Utility function to handle API responses and automatically redirect on session expiration
 */
export async function handleApiResponse<T>(
  response: Response,
  handleSessionExpired: () => Promise<void>
): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    let errorData;
    
    try {
      errorData = JSON.parse(errorText);
    } catch {
      // If not JSON, use the text as error message
      throw new Error(`API Error: ${response.status} ${errorText}`);
    }

    // Check if the error is due to session expiration
    if (response.status === 401 && errorData.error === 'Session expired') {
      logger.log('🔄 Session expired detected, redirecting to login');
      await handleSessionExpired();
      throw new Error('Session expired - redirecting to login');
    }

    // For other errors, throw with the error message
    throw new Error(errorData.error || `API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Hook to get API utilities with session handling
 */
export function useApiUtils() {
  const { handleSessionExpired } = useAuthContext();

  const apiCall = useCallback(async <T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> => {
    const response = await fetch(url, options);
    return handleApiResponse<T>(response, handleSessionExpired);
  }, [handleSessionExpired]);

  return { apiCall };
}
