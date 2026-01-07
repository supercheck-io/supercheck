import { TextEncoder, TextDecoder } from 'util';

// Polyfill TextEncoder/TextDecoder for Next.js 15 compatibility (required by next/cache)
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

import '@testing-library/jest-dom';

// Mock next/cache to avoid Web API polyfill requirements
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn) => fn),
}));

// Mock bullmq to avoid msgpackr ESM issues
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    remove: jest.fn(),
    close: jest.fn(),
  })),
  Worker: jest.fn(),
  QueueScheduler: jest.fn(),
}));

// Mock better-auth to avoid jose ESM issues  
jest.mock('better-auth', () => ({
  betterAuth: jest.fn(() => ({
    api: { getSession: jest.fn() },
  })),
}));

jest.mock('better-auth/next-js', () => ({
  nextCookies: jest.fn(() => ({})),
  toNextJsHandler: jest.fn(),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

// Suppress expected console output in tests (comment out for debugging)
const originalError = console.error;
const originalLog = console.log;
const originalWarn = console.warn;

beforeAll(() => {
  // Suppress expected error patterns in tests
  console.error = (...args: unknown[]) => {
    const message = typeof args[0] === 'string' ? args[0] : '';
    const suppressedPatterns = [
      'Warning: ReactDOM.render',
      'Error updating alert',
      'Error deleting alert',
      'Error creating alert',
      'Failed to get alert',
      'Failed to save alert history',
      'Failed to get alerts for monitor',
      'Failed to resolve variable',
      'Failed to resolve variables',
      'Error getting current user',
      'Error getting user organizations',
      'Error getting user projects',
      'Error getting user project role',
      '[SubscriptionService]',
      'CRITICAL: Plan limits',
      'Failed to schedule job',
      'Failed to calculate next run date',
      'Failed to delete scheduled job',
      'Failed to initialize',
      'Failed to process scheduled job',
      'Error in requireSuperAdmin',
      'Error cleaning up Redis',
      'No test cases found',
      '[AI Security]',
      'Error checking impersonation state',
      'Error creating requirement:',
      'Error deleting from S3:',
      'Error fetching documents:',
      'PDF appears to be image-based',
      'Error extracting DOCX text:',
      '[PDF Extraction]',
    ];
    if (suppressedPatterns.some(pattern => message.includes(pattern))) {
      return;
    }
    originalError.call(console, ...args);
  };

  // Suppress expected log patterns
  console.log = (...args: unknown[]) => {
    const message = typeof args[0] === 'string' ? args[0] : '';
    const suppressedPatterns = [
      'Alert history saved:',
      'Alert .* deleted successfully',
      'Resolved .* variables and .* secrets',
      'pre-resolved test scripts',
      '\\[JobScheduler\\]',
      '\\[AI Extraction\\]',
      '\\[PDF Extraction\\]',
    ];
    if (suppressedPatterns.some(pattern => new RegExp(pattern).test(message))) {
      return;
    }
    originalLog.call(console, ...args);
  };

  // Suppress expected warn patterns
  console.warn = (...args: unknown[]) => {
    const message = typeof args[0] === 'string' ? args[0] : '';
    // Also check if second argument is an object with details about the warning
    const secondArg = typeof args[1] === 'object' && args[1] !== null ? JSON.stringify(args[1]) : '';
    const suppressedPatterns = [
      '[SubscriptionService]',
      'Plan limits not found',
      '[AI Security]',
      'AI-generated code failed validation',
      'attempted to create requirement without permission',
      'attempted to update requirement',
      'attempted to delete requirement',
    ];
    if (suppressedPatterns.some(pattern => message.includes(pattern) || secondArg.includes(pattern))) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.log = originalLog;
  console.warn = originalWarn;
});
