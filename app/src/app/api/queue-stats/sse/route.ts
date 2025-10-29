import { NextRequest } from 'next/server';
import { getQueueStats } from '@/lib/queue-stats';

// Helper to create SSE messages
const encoder = new TextEncoder();
function createSSEMessage<T>(data: T) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  // Set up response headers for SSE
  const responseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };

  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      
      // Setup abort handling
      request.signal.addEventListener('abort', () => {
        aborted = true;
        try {
          controller.close();
        } catch {
          // Ignore errors when closing
        }
      });

      // Function to send queue stats
      const sendStats = async () => {
        try {
          const stats = await getQueueStats();
          const message = createSSEMessage(stats);
          controller.enqueue(encoder.encode(message));
        } catch {
          // Suppress detailed error logging to reduce noise
          console.error('Error in SSE stream');
        }
      };

      // Send initial stats
      await sendStats();

      // Set up interval to send updated stats
      const interval = setInterval(async () => {
        if (aborted) {
          clearInterval(interval);
          return;
        }
        await sendStats();
      }, 1000); // More frequent updates (every 1 second)

      // Set up cleanup when the client disconnects
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
      });
    }
  });

  return new Response(stream, {
    headers: responseHeaders,
  });
} 