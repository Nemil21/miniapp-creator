/**
 * Development-only logger
 * Logs are suppressed in production to keep logs clean
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

export const logger = {
  log: (...args: unknown[]) => {
    if (IS_DEV) {
      console.log(...args);
    }
  },
  
  info: (...args: unknown[]) => {
    if (IS_DEV) {
      console.info(...args);
    }
  },
  
  warn: (...args: unknown[]) => {
    if (IS_DEV) {
      console.warn(...args);
    }
  },
  
  error: (...args: unknown[]) => {
    // Always log errors, even in production
    console.error(...args);
  },
  
  debug: (...args: unknown[]) => {
    if (IS_DEV) {
      console.debug(...args);
    }
  },
};

/**
 * Log API requests (dev only)
 */
export function logApiRequest(method: string, path: string, userId?: string) {
  if (IS_DEV) {
    console.log(`🔍 ${method} ${path}${userId ? ` - user: ${userId}` : ''}`);
  }
}

/**
 * Log errors with additional context (always logs)
 */
export function logErrorWithContext(error: unknown, context: string, additionalInfo?: Record<string, unknown>) {
  console.error(`❌ Error in ${context}:`, error);
  if (additionalInfo && IS_DEV) {
    console.error('Additional context:', additionalInfo);
  }
}

// For compatibility with existing code that uses console directly
export default logger;
