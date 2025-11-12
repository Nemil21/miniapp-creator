/**
 * Logger with environment-based controls
 * - Development: All logs enabled
 * - Production: Only errors by default, can enable all logs with NEXT_PUBLIC_ENABLE_LOGS=true
 */

const IS_DEV = process.env.NODE_ENV !== 'production';
const ENABLE_PROD_LOGS = process.env.NEXT_PUBLIC_ENABLE_LOGS === 'true';
const SHOULD_LOG = IS_DEV || ENABLE_PROD_LOGS;

export const logger = {
  log: (...args: unknown[]) => {
    if (SHOULD_LOG) {
      console.log(...args);
    }
  },
  
  info: (...args: unknown[]) => {
    if (SHOULD_LOG) {
      console.info(...args);
    }
  },
  
  warn: (...args: unknown[]) => {
    if (SHOULD_LOG) {
      console.warn(...args);
    }
  },
  
  error: (...args: unknown[]) => {
    // Always log errors, even in production
    console.error(...args);
  },
  
  debug: (...args: unknown[]) => {
    if (SHOULD_LOG) {
      console.debug(...args);
    }
  },
};

/**
 * Log API requests (dev only or when logging enabled)
 */
export function logApiRequest(method: string, path: string, userId?: string) {
  if (SHOULD_LOG) {
    console.log(`🔍 ${method} ${path}${userId ? ` - user: ${userId}` : ''}`);
  }
}

/**
 * Log errors with additional context (always logs)
 */
export function logErrorWithContext(error: unknown, context: string, additionalInfo?: Record<string, unknown>) {
  console.error(`❌ Error in ${context}:`, error);
  if (additionalInfo && SHOULD_LOG) {
    console.error('Additional context:', additionalInfo);
  }
}

// For compatibility with existing code that uses console directly
export default logger;
