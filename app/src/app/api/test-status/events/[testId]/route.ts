import { NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { reports } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import Redis from 'ioredis';

/**
 * Helper function to create SSE message
 */
const createSSEMessage = (data: Record<string, unknown>) => {
  return `data: ${JSON.stringify(data)}\n\n`;
};

/**
 * Helper function to get Redis connection
 */
const getRedisConnection = async (): Promise<Redis> => {
  console.log(`Creating Redis connection for SSE endpoint`);
  
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379');
  const password = process.env.REDIS_PASSWORD;
  
  console.log(`[SSE Redis Client] Connecting to Redis at ${host}:${port}`);
  
  const redis = new Redis({
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  
  redis.on('error', (err) => console.error('[SSE Redis Client Error]', err));
  redis.on('connect', () => console.log('[SSE Redis Client Connected]'));
  
  return redis;
};

export async function GET(request: Request) {
  // Extract testId from the URL path
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const testId = pathParts[pathParts.length - 1]; // Get the last part of the URL

  let connectionClosed = false;
  
  // Create response with appropriate headers for SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Check if we already have a result for this test
        
        // Get the specific report by test ID
        const report = await db.query.reports.findFirst({
          where: and(
            eq(reports.entityType, 'test'),
            eq(reports.entityId, testId)
          ),
        });

        // If report exists and has a terminal status, send result and close
        if (report && ['completed', 'failed'].includes(report.status)) {
          controller.enqueue(encoder.encode(createSSEMessage({ 
            status: report.status,
            testId: report.entityId,
            reportPath: report.reportPath,
            s3Url: report.s3Url,
            error: undefined
          })));
          connectionClosed = true;
          controller.close();
          return;
        }

        // Get Redis connection for pub/sub
        const subscriber = await getRedisConnection();
        
        // Handle disconnection
        const cleanup = async () => {
          if (!connectionClosed) {
            connectionClosed = true;
            controller.close();
            console.log(`[SSE] Client disconnected for test ${testId}`);
            // Clean up Redis connection
            try {
              await subscriber.disconnect();
            } catch (err) {
              console.error(`Error disconnecting Redis: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        };
        
        request.signal.addEventListener('abort', () => {
          cleanup().catch(err => console.error("Error in cleanup:", err));
        });
        
        // Set up ping interval to keep connection alive
        const pingInterval = setInterval(() => {
          if (!connectionClosed) {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);
        
        // Clean up on close
        request.signal.addEventListener('abort', () => {
          clearInterval(pingInterval);
        });
        
        // Send initial running status if we have an active report
        if (report && report.status === 'running') {
          controller.enqueue(encoder.encode(createSSEMessage({ 
            status: 'running',
            testId: report.entityId
          })));
        } else {
          controller.enqueue(encoder.encode(createSSEMessage({ status: 'waiting' })));
        }
        
        // Subscribe to Redis channels for test status updates
        const testStatusChannel = `test:${testId}:status`;
        const testCompleteChannel = `test:${testId}:complete`;
        
        console.log(`[SSE] Subscribing to channels: ${testStatusChannel}, ${testCompleteChannel}`);
        
        // Subscribe to status updates
        await subscriber.subscribe(testStatusChannel, testCompleteChannel);
        
        // Handle messages from Redis pub/sub
        subscriber.on('message', async (channel, message) => {
          if (connectionClosed) return;
          
          try {
            const data = JSON.parse(message);
            console.log(`[SSE] Received message on channel ${channel}:`, data);
            
            if (channel === testCompleteChannel) {
              // Test completed, send final status and close connection
              controller.enqueue(encoder.encode(createSSEMessage({
                status: data.status,
                testId: data.testId,
                reportPath: data.reportPath,
                s3Url: data.s3Url,
                error: data.error
              })));
              
              connectionClosed = true;
              clearInterval(pingInterval);
              await cleanup();
              controller.close();
            } else if (channel === testStatusChannel) {
              // Status update
              controller.enqueue(encoder.encode(createSSEMessage({
                status: data.status,
                testId: data.testId,
                reportPath: data.reportPath,
                s3Url: data.s3Url,
                error: data.error
              })));
            }
          } catch (parseError) {
            console.error(`[SSE] Error parsing message from channel ${channel}:`, parseError);
          }
        });
        
        // Set up a fallback mechanism to check database periodically (less frequent)
        // This is only for cases where Redis pub/sub might miss events
        const fallbackInterval = setInterval(async () => {
          if (connectionClosed) {
            clearInterval(fallbackInterval);
            return;
          }
          
          try {
            // Check database for terminal status (less frequent than before)
            const dbReport = await db.query.reports.findFirst({
              where: and(
                eq(reports.entityType, 'test'),
                eq(reports.entityId, testId)
              ),
            });
            
            if (dbReport && ['completed', 'failed'].includes(dbReport.status)) {
              console.log(`[SSE] Fallback: Test ${testId} has terminal status ${dbReport.status} in database`);
              
              controller.enqueue(encoder.encode(createSSEMessage({ 
                status: dbReport.status,
                testId: dbReport.entityId,
                reportPath: dbReport.reportPath,
                s3Url: dbReport.s3Url,
                error: undefined
              })));
              
              connectionClosed = true;
              clearInterval(fallbackInterval);
              await cleanup();
              controller.close();
            }
          } catch (fallbackError) {
            console.error(`[SSE] Error in fallback check for test ${testId}:`, fallbackError);
          }
        }, 30000); // Check every 30 seconds instead of every second
        
        // Clean up fallback interval on close
        request.signal.addEventListener('abort', () => {
          clearInterval(fallbackInterval);
        });
        
      } catch (err) {
        console.error('[SSE] Error in SSE stream:', err);
        controller.enqueue(encoder.encode(createSSEMessage({ 
          status: 'error', 
          message: 'Failed to establish status stream' 
        })));
        
        // Clean up resources
        connectionClosed = true;
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
} 