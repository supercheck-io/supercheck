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

// Radix primitives measure their triggers with ResizeObserver. jsdom does not
// implement it, so provide a no-op observer for component tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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
  // Minimal Headers stub for jsdom. `append` follows the Fetch spec and joins
  // repeated values with a comma, so code that reads a combined header sees the
  // same value it would get from Undici in a node-environment test.
  class HeadersStub {
    private _map = new Map<string, string>();

    constructor(init?: Record<string, string> | HeadersStub | Iterable<[string, string]>) {
      if (!init) return;
      if (init instanceof HeadersStub) {
        init.forEach((value, key) => this.append(key, value));
        return;
      }
      if (typeof (init as Iterable<[string, string]>)[Symbol.iterator] === 'function') {
        for (const [key, value] of init as Iterable<[string, string]>) {
          this.append(key, value);
        }
        return;
      }
      Object.entries(init as Record<string, string>).forEach(([key, value]) => this.append(key, value));
    }

    append(name: string, value: string) {
      const key = name.toLowerCase();
      const existing = this._map.get(key);
      this._map.set(key, existing === undefined ? String(value) : `${existing}, ${String(value)}`);
    }
    get(name: string) { return this._map.get(name.toLowerCase()) ?? null; }
    has(name: string) { return this._map.has(name.toLowerCase()); }
    set(name: string, value: string) { this._map.set(name.toLowerCase(), String(value)); }
    delete(name: string) { this._map.delete(name.toLowerCase()); }
    forEach(cb: (value: string, key: string) => void) { this._map.forEach(cb); }
    keys() { return this._map.keys(); }
    values() { return this._map.values(); }
    entries() { return this._map.entries(); }
    [Symbol.iterator]() { return this._map.entries(); }
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
    statusText: string;
    headers: InstanceType<typeof globalThis.Headers>;

    static json(data: unknown, init?: { status?: number; statusText?: string; headers?: Record<string, string> }) {
      const body = JSON.stringify(data);
      const headers = new globalThis.Headers(init?.headers);
      headers.set('Content-Type', 'application/json');
      return new ResponseStub(body, { ...init, headers });
    }

    constructor(body?: unknown, init?: { status?: number; statusText?: string; headers?: any }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? '';
      this.headers = init?.headers instanceof globalThis.Headers 
        ? init.headers 
        : new globalThis.Headers(init?.headers);
    }

    // `ok` and `clone` are part of the real Response surface that application
    // code relies on (`response.ok`, `response.clone().text()`), so returning
    // undefined here would silently push those paths down their failure branch.
    get ok() { return this.status >= 200 && this.status < 300; }

    clone() {
      return new ResponseStub(this.body, {
        status: this.status,
        statusText: this.statusText,
        headers: new globalThis.Headers(this.headers),
      });
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
