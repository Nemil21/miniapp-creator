import { logger } from "../../../lib/logger";
import { NextResponse } from 'next/server';
import { db } from '../../../db';
import { sql } from 'drizzle-orm';

/**
 * GET /health
 * Health check endpoint for monitoring and load balancers
 * 
 * This endpoint checks:
 * - Database connectivity
 * - Preview host availability
 * - System configuration
 * - Feature flags
 * 
 * Used by:
 * - Railway for health monitoring
 * - Vercel for deployment checks
 * - External monitoring services
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  const startTime = Date.now();

  logger.log('🏥 Health check requested at', timestamp);

  // Check database connection
  let databaseStatus = 'connected';
  let databaseLatency = 0;
  try {
    const dbStart = Date.now();
    await db.execute(sql`SELECT 1 as health_check`);
    databaseLatency = Date.now() - dbStart;
    logger.log(`✅ Database: connected (${databaseLatency}ms)`);
  } catch (error) {
    databaseStatus = 'disconnected';
    logger.error('❌ Database: disconnected', error);
  }

  // Check preview host connection
  let previewHostStatus = 'unknown';
  let previewHostLatency = 0;
  const previewApiBase = process.env.PREVIEW_API_BASE;
  
  if (previewApiBase) {
    try {
      const previewStart = Date.now();
      const response = await fetch(`${previewApiBase}/health`, {
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      previewHostLatency = Date.now() - previewStart;
      
      if (response.ok) {
        previewHostStatus = 'connected';
        logger.log(`✅ Preview host: connected (${previewHostLatency}ms)`);
      } else {
        previewHostStatus = 'error';
        logger.warn(`⚠️ Preview host: returned ${response.status}`);
      }
    } catch (error) {
      previewHostStatus = 'disconnected';
      logger.error('❌ Preview host: disconnected', error);
    }
  } else {
    previewHostStatus = 'not_configured';
    logger.warn('⚠️ Preview host: PREVIEW_API_BASE not configured');
  }

  // Determine overall status
  const status =
    databaseStatus === 'connected' && previewHostStatus === 'connected'
      ? 'healthy'
      : databaseStatus === 'connected'
      ? 'degraded'
      : 'unhealthy';

  // Get feature flags
  const features = {
    asyncProcessing: process.env.USE_ASYNC_PROCESSING === 'true',
    vercelDeployment: process.env.ENABLE_VERCEL_DEPLOYMENT === 'true',
    netlifyDeployment: process.env.ENABLE_NETLIFY_DEPLOYMENT === 'true',
    contractDeployment: process.env.ENABLE_CONTRACT_DEPLOYMENT === 'true',
  };

  // Get environment info
  const environment = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
  };

  const responseTime = Date.now() - startTime;

  const response = {
    status,
    timestamp,
    responseTime: `${responseTime}ms`,
    services: {
      database: {
        status: databaseStatus,
        latency: `${databaseLatency}ms`,
      },
      previewHost: {
        status: previewHostStatus,
        latency: previewHostLatency > 0 ? `${previewHostLatency}ms` : 'n/a',
        url: previewApiBase || 'not_configured',
      },
    },
    features,
    environment,
    version: '1.0.0',
    uptime: process.uptime(),
  };

  // Log overall status
  logger.log(`🏥 Health check complete: ${status} (${responseTime}ms)\n`);

  // Return appropriate HTTP status code
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}

/**
 * HEAD /health
 * Lightweight health check (no body)
 */
export async function HEAD() {
  try {
    // Quick database check
    await db.execute(sql`SELECT 1`);
    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

