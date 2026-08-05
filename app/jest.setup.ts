import { TextEncoder, TextDecoder } from 'util';
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'node:stream/web';

// Polyfill TextEncoder/TextDecoder for Next.js compatibility
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

if (typeof globalThis.ReadableStream === 'undefined') {
  Object.defineProperty(globalThis, 'ReadableStream', {
    value: ReadableStream,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.WritableStream === 'undefined') {
  Object.defineProperty(globalThis, 'WritableStream', {
    value: WritableStream,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.TransformStream === 'undefined') {
  Object.defineProperty(globalThis, 'TransformStream', {
    value: TransformStream,
    writable: true,
    configurable: true,
  });
}

// Polyfill Fetch API primitives for Next.js server utilities in Jest.
// Tests in jsdom don't need a real fetch — they mock all network calls.
// Tests needing real fetch use @jest-environment node where these exist natively.
if (typeof globalThis.fetch === 'undefined') {
  Object.defineProperty(globalThis, 'fetch', {
    value: (() => {
      throw new Error('fetch is not implemented in this test environment. Use @jest-environment node or mock the call.');
    }) as unknown as typeof globalThis.fetch,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.Headers === 'undefined') {
  // Minimal Headers stub — enough to satisfy import-time checks
  class HeadersStub {
    private _map = new Map<string, string>();
    constructor(init?: Record<string, string> | HeadersStub) {
      if (init) {
        if (init instanceof HeadersStub) {
          init.forEach((v, k) => this.append(k, v));
        } else {
          Object.entries(init).forEach(([k, v]) => this.append(k, v));
        }
      }
    }
    append(name: string, value: string) { this._map.set(name.toLowerCase(), value); }
    get(name: string) { return this._map.get(name.toLowerCase()) ?? null; }
    has(name: string) { return this._map.has(name.toLowerCase()); }
    set(name: string, value: string) { this._map.set(name.toLowerCase(), value); }
    delete(name: string) { this._map.delete(name.toLowerCase()); }
    forEach(cb: (value: string, key: string) => void) { this._map.forEach(cb); }
  }
  Object.defineProperty(globalThis, 'Headers', {
    value: HeadersStub,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.Request === 'undefined') {
  class RequestStub {
    headers: InstanceType<typeof globalThis.Headers>;
    constructor(input: string | URL, init?: { method?: string; headers?: Record<string, string> }) {
      // Use defineProperty so subclasses (like NextRequest) can override with a getter
      Object.defineProperty(this, 'url', {
        value: typeof input === 'string' ? input : input.toString(),
        writable: true,
        configurable: true,
        enumerable: true,
      });
      Object.defineProperty(this, 'method', {
        value: init?.method ?? 'GET',
        writable: true,
        configurable: true,
        enumerable: true,
      });
      this.headers = new globalThis.Headers(init?.headers);
    }
  }
  Object.defineProperty(globalThis, 'Request', {
    value: RequestStub,
    writable: true,
    configurable: true,
  });
}

if (typeof globalThis.Response === 'undefined') {
  class ResponseStub {
    body: unknown;
    status: number;
    headers: InstanceType<typeof globalThis.Headers>;
    
    static json(data: unknown, init?: { status?: number; statusText?: string; headers?: Record<string, string> }) {
      const body = JSON.stringify(data);
      const headers = new globalThis.Headers(init?.headers);
      headers.set('Content-Type', 'application/json');
      return new ResponseStub(body, { ...init, headers });
    }

    constructor(body?: unknown, init?: { status?: number; headers?: any }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = init?.headers instanceof globalThis.Headers 
        ? init.headers 
        : new globalThis.Headers(init?.headers);
    }
    
    json() { 
      if (typeof this.body === 'string') {
        try {
          return Promise.resolve(JSON.parse(this.body));
        } catch {
          return Promise.resolve(this.body);
        }
      }
      return Promise.resolve(this.body); 
    }
    
    text() { return Promise.resolve(String(this.body)); }
    
    arrayBuffer() {
      const encoder = new TextEncoder();
      const view = encoder.encode(String(this.body ?? ''));
      return Promise.resolve(view.buffer);
    }
  }
  Object.defineProperty(globalThis, 'Response', {
    value: ResponseStub,
    writable: true,
    configurable: true,
  });
}

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

// Suppress console output during tests (allow opting out via DEBUG/VERBOSE env vars)
const originalError = console.error;
const originalLog = console.log;
const originalWarn = console.warn;
const originalInfo = console.info;
const originalDebug = console.debug;
const originalTrace = console.trace;

beforeAll(() => {
  if (process.env.DEBUG || process.env.VERBOSE) {
    return;
  }
  console.error = () => {};
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.trace = () => {};
});

afterAll(() => {
  console.error = originalError;
  console.log = originalLog;
  console.warn = originalWarn;
  console.info = originalInfo;
  console.debug = originalDebug;
  console.trace = originalTrace;
});
