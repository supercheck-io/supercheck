// index.js - Simple Express app with manual instrumentation
import express from 'express';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const app = express();
const PORT = 3333;

// Get tracer for manual instrumentation
const tracer = trace.getTracer('signoz-test-app', '1.0.0');

// Middleware to parse JSON
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'SigNoz Test Application',
    status: 'healthy',
    endpoints: {
      health: 'GET /health',
      users: 'GET /users',
      process: 'POST /process',
      error: 'GET /error',
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple data endpoint
app.get('/users', async (req, res) => {
  // Manual span for database simulation
  const span = tracer.startSpan('fetch-users-from-db');
  span.setAttribute('db.system', 'postgresql');
  span.setAttribute('db.operation', 'SELECT');
  span.setAttribute('db.table', 'users');

  try {
    // Simulate database query
    await sleep(50);

    const users = [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com' },
    ];

    span.setAttribute('db.rows_returned', users.length);
    span.setStatus({ code: SpanStatusCode.OK });

    res.json({ users, count: users.length });
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    span.end();
  }
});

// Complex processing endpoint with nested spans
app.post('/process', async (req, res) => {
  const parentSpan = tracer.startSpan('process-data');
  const { data } = req.body;

  try {
    parentSpan.setAttribute('input.size', data?.length || 0);

    // Step 1: Validate
    const validateSpan = tracer.startSpan('validate-input', {
      parent: parentSpan,
    });
    await sleep(20);
    validateSpan.setStatus({ code: SpanStatusCode.OK });
    validateSpan.end();

    // Step 2: Transform
    const transformSpan = tracer.startSpan('transform-data', {
      parent: parentSpan,
    });
    await sleep(30);
    transformSpan.setAttribute('transformation.type', 'uppercase');
    transformSpan.setStatus({ code: SpanStatusCode.OK });
    transformSpan.end();

    // Step 3: Save
    const saveSpan = tracer.startSpan('save-to-storage', {
      parent: parentSpan,
    });
    saveSpan.setAttribute('storage.type', 's3');
    saveSpan.setAttribute('storage.bucket', 'test-bucket');
    await sleep(40);
    saveSpan.setStatus({ code: SpanStatusCode.OK });
    saveSpan.end();

    parentSpan.setStatus({ code: SpanStatusCode.OK });
    res.json({
      message: 'Data processed successfully',
      steps: ['validate', 'transform', 'save'],
    });
  } catch (error) {
    parentSpan.recordException(error);
    parentSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    parentSpan.end();
  }
});

// Error endpoint to test error tracking
app.get('/error', (req, res) => {
  const span = tracer.startSpan('intentional-error');

  try {
    // This will throw an error
    throw new Error('This is a test error for SigNoz');
  } catch (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.end();

    res.status(500).json({
      error: error.message,
      note: 'This error is intentional for testing'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 SigNoz Test Application started');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log('📡 Sending telemetry to: http://localhost:4318');
  console.log('');
  console.log('Try these endpoints:');
  console.log(`  curl http://localhost:${PORT}/`);
  console.log(`  curl http://localhost:${PORT}/health`);
  console.log(`  curl http://localhost:${PORT}/users`);
  console.log(`  curl -X POST http://localhost:${PORT}/process -H "Content-Type: application/json" -d '{"data":"test"}'`);
  console.log(`  curl http://localhost:${PORT}/error`);
  console.log('');
  console.log('View traces in SigNoz UI: http://localhost:8080');
  console.log('');
});

// Helper function to simulate async operations
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
