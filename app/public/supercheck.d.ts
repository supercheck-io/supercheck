

// === Complete k6 Performance Testing Type Definitions ===

/**
 * k6 Core Module - Performance testing functions
 * https://grafana.com/docs/k6/latest/javascript-api/k6/
 */
declare module "k6" {
  /**
   * Check procedure for validating values.
   * @template VT - The type of value being checked
   */
  export interface Checker<VT> {
    /** Check procedure that returns true if check passed. */
    (val: VT): boolean;
  }

  /**
   * Named check procedures mapped by description.
   * @template VT - The type of value being checked
   */
  export interface Checkers<VT> {
    [description: string]: Checker<VT>;
  }

  /**
   * Run checks on a value.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/check/
   * @template VT - Value type
   * @param val - Value to test
   * @param sets - Tests (checks) to run on the value
   * @param tags - Extra tags to attach to metrics emitted
   * @returns `true` if all checks have succeeded, otherwise `false`
   * @example
   * ```javascript
   * check(res, {
   *   "response code was 200": (res) => res.status === 200,
   *   "body size was correct": (res) => res.body.length === 1234,
   * });
   * ```
   */
  export function check<VT>(val: VT, sets: Checkers<VT>, tags?: object): boolean;

  /**
   * Immediately throw an error, aborting the current script iteration.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/fail/
   * @param err - Error message that gets printed to stderr
   * @example
   * ```javascript
   * fail("abort current iteration");
   * ```
   */
  export function fail(err?: string): never;

  /**
   * Run code inside a group for organizing test logic.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/group/
   * @template RT - Return type
   * @param name - Name of the group
   * @param fn - Group body. Code to be executed in the group context
   * @returns The return value of `fn`
   * @example
   * ```javascript
   * group("user login flow", function() {
   *   // login logic here
   * });
   * ```
   */
  export function group<RT>(name: string, fn: () => RT): RT;

  /**
   * Set seed to get a reproducible pseudo-random number using Math.random.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/randomseed/
   * @param int - The seed value
   * @example
   * ```javascript
   * randomSeed(123456789);
   * ```
   */
  export function randomSeed(int: number): void;

  /**
   * Suspend VU execution for the specified duration.
   * https://grafana.com/docs/k6/latest/javascript-api/k6/sleep/
   * @param t - Duration in seconds (can be fractional)
   * @example
   * ```javascript
   * sleep(1);      // Sleep for 1 second
   * sleep(0.5);    // Sleep for 500ms
   * sleep(Math.random() * 3); // Random sleep 0-3 seconds
   * ```
   */
  export function sleep(t: number): void;
}

/**
 * k6 HTTP Module - HTTP client for load testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-http/
 */
declare module "k6/http" {
  /**
   * HTTP request timing information
   */
  export interface ResponseTimings {
    /** Time waiting for first byte of response */
    waiting: number;
    /** Time receiving data */
    receiving: number;
    /** Time establishing TCP connection */
    connecting: number;
    /** Time for TLS handshake */
    tls_handshaking: number;
    /** Time sending request data */
    sending: number;
    /** Time blocked before initiating the request */
    blocked: number;
    /** Time resolving DNS */
    looking_up: number;
    /** Total request duration */
    duration: number;
  }

  /**
   * Cookie object received in response
   */
  export interface ResponseCookie {
    /** Cookie name */
    name: string;
    /** Cookie value */
    value: string;
    /** Cookie domain */
    domain: string;
    /** Cookie path */
    path: string;
    /** Expiration time (Unix timestamp) */
    expires: number;
    /** Max age in seconds */
    max_age: number;
    /** HTTP only flag */
    httpOnly: boolean;
    /** Secure flag */
    secure: boolean;
    /** SameSite attribute */
    sameSite: "Strict" | "Lax" | "None";
  }

  /**
   * HTTP Response object returned by all request methods
   */
  export interface Response {
    /** Response body as a string. Use json() to parse JSON. */
    body: string | null;
    /** HTTP response headers */
    headers: { [key: string]: string };
    /** HTTP status code (e.g., 200, 404, 500) */
    status: number;
    /** HTTP status text (e.g., "OK", "Not Found") */
    status_text: string;
    /** Final URL after any redirects */
    url: string;
    /** Error message if request failed */
    error: string;
    /** Error code for failed requests */
    error_code: number;
    /** Request timing information */
    timings: ResponseTimings;
    /** Cookies set by the server */
    cookies: { [name: string]: ResponseCookie[] };
    /** The request that generated this response */
    request: {
      method: string;
      url: string;
      headers: { [key: string]: string };
      body: string;
      cookies: { [key: string]: { value: string; replace: boolean }[] };
    };
    /** Parse response body as JSON */
    json(selector?: string): any;
    /** Parse response body as HTML for jQuery-like selection */
    html(selector?: string): any;
    /** Submit a form from the response */
    submitForm(options?: { formSelector?: string; fields?: object; submitSelector?: string; params?: Params }): Response;
    /** Click a link in the response */
    clickLink(options?: { selector?: string; params?: Params }): Response;
  }

  /**
   * HTTP request parameters
   */
  export interface Params {
    /** Request-specific cookies */
    cookies?: { [name: string]: string | { value: string; replace?: boolean } };
    /** Request headers */
    headers?: { [key: string]: string };
    /** Cookie jar to use for the request */
    jar?: CookieJar;
    /** Maximum number of redirects to follow (default: 10) */
    redirects?: number;
    /** Tags to attach to metrics */
    tags?: { [key: string]: string };
    /** Request timeout (default: 60s). Number in ms or string like "30s" */
    timeout?: string | number;
    /** Compression algorithm: "gzip", "deflate", "br", "zstd" */
    compression?: string;
    /** Response type: "text" (default), "binary", or "none" */
    responseType?: "text" | "binary" | "none";
    /** Authentication method: "basic", "digest", "ntlm" */
    auth?: "basic" | "digest" | "ntlm";
  }

  /**
   * Cookie jar for managing cookies
   */
  export interface CookieJar {
    /** Set a cookie in the jar */
    set(url: string, name: string, value: string, options?: { domain?: string; path?: string; expires?: string; max_age?: number; secure?: boolean; http_only?: boolean }): void;
    /** Get cookies for a URL */
    cookiesForURL(url: string): { [name: string]: string[] };
    /** Clear all cookies from the jar */
    clear(url: string): void;
    /** Delete a specific cookie */
    delete(url: string, name: string): void;
  }

  /**
   * Batch request definition - array format
   */
  export type BatchRequest = [method: string, url: string, body?: string | object | null, params?: Params];

  /**
   * Batch request definition - object format
   */
  export interface BatchRequestObject {
    method: string;
    url: string;
    body?: string | object | null;
    params?: Params;
  }

  /**
   * Perform an HTTP GET request.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/get/
   * @param url - Request URL
   * @param params - Optional request parameters
   * @returns HTTP Response object
   * @example
   * ```javascript
   * const res = http.get("https://test-api.k6.io/public/crocodiles/1/");
   * console.log(res.status); // 200
   * ```
   */
  export function get(url: string, params?: Params): Response;

  /**
   * Perform an HTTP POST request.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/post/
   * @param url - Request URL
   * @param body - Request body (string, object, or null)
   * @param params - Optional request parameters
   * @returns HTTP Response object
   * @example
   * ```javascript
   * const payload = JSON.stringify({ username: "test", password: "secret" });
   * const res = http.post("https://api.example.com/login", payload, {
   *   headers: { "Content-Type": "application/json" }
   * });
   * ```
   */
  export function post(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP PUT request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function put(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP DELETE request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function del(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP PATCH request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function patch(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform an HTTP HEAD request.
   * @param url - Request URL
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function head(url: string, params?: Params): Response;

  /**
   * Perform an HTTP OPTIONS request.
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function options(url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform a generic HTTP request.
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param url - Request URL
   * @param body - Request body
   * @param params - Optional request parameters
   * @returns HTTP Response object
   */
  export function request(method: string, url: string, body?: string | object | null, params?: Params): Response;

  /**
   * Perform multiple HTTP requests in parallel.
   * https://grafana.com/docs/k6/latest/javascript-api/k6-http/batch/
   * @param requests - Array or object of request definitions
   * @returns Array or object of Response objects
   * @example
   * ```javascript
   * const responses = http.batch([
   *   ["GET", "https://api.example.com/users"],
   *   ["GET", "https://api.example.com/posts"],
   * ]);
   * ```
   */
  export function batch(requests: (BatchRequest | BatchRequestObject)[]): Response[];
  export function batch(requests: { [key: string]: BatchRequest | BatchRequestObject }): { [key: string]: Response };

  /**
   * Create a new cookie jar.
   * @returns A new CookieJar instance
   */
  export function cookieJar(): CookieJar;

  /**
   * Encode an object as multipart/form-data.
   * @param data - Object containing form fields and file data
   * @param boundary - Optional boundary string
   * @returns Encoded string suitable for request body
   */
  export function file(data: ArrayBuffer | string, filename?: string, contentType?: string): object;

  /**
   * Set the default response callback for all HTTP requests.
   * @param callback - Callback function to process responses
   */
  export function setResponseCallback(callback: ((response: Response) => void) | null): void;

  /**
   * Expected HTTP statuses for response validation.
   * @param statuses - Expected status codes
   * @returns Callback for setResponseCallback
   */
  export function expectedStatuses(...statuses: (number | { min: number; max: number })[]): (response: Response) => void;

  /** Default HTTP module export */
  const http: {
    get: typeof get;
    post: typeof post;
    put: typeof put;
    del: typeof del;
    patch: typeof patch;
    head: typeof head;
    options: typeof options;
    request: typeof request;
    batch: typeof batch;
    cookieJar: typeof cookieJar;
    file: typeof file;
    setResponseCallback: typeof setResponseCallback;
    expectedStatuses: typeof expectedStatuses;
  };
  export default http;
}

/**
 * k6 Metrics Module - Custom metrics for performance analysis
 * https://grafana.com/docs/k6/latest/javascript-api/k6-metrics/
 */
declare module "k6/metrics" {
  /**
   * Counter metric - cumulative count that can only increase
   * @example
   * ```javascript
   * const myCounter = new Counter("my_requests");
   * myCounter.add(1);
   * myCounter.add(5, { tag: "value" });
   * ```
   */
  export class Counter {
    /** Create a new Counter metric */
    constructor(name: string, isTime?: boolean);
    /** Add a value to the counter */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Gauge metric - stores the last value added
   * @example
   * ```javascript
   * const myGauge = new Gauge("current_connections");
   * myGauge.add(10);
   * myGauge.add(5); // Now value is 5
   * ```
   */
  export class Gauge {
    /** Create a new Gauge metric */
    constructor(name: string, isTime?: boolean);
    /** Set the gauge value */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Rate metric - tracks the percentage of added values that are non-zero
   * @example
   * ```javascript
   * const errorRate = new Rate("errors");
   * errorRate.add(false); // success
   * errorRate.add(true);  // failure - rate increases
   * ```
   */
  export class Rate {
    /** Create a new Rate metric */
    constructor(name: string);
    /** Add a value (true/1 = failure, false/0 = success) */
    add(value: boolean | number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }

  /**
   * Trend metric - calculates statistics (min, max, avg, percentiles)
   * @example
   * ```javascript
   * const responseTime = new Trend("response_time");
   * responseTime.add(245);
   * responseTime.add(150);
   * // Access via thresholds: 'response_time': ['avg<300', 'p(95)<500']
   * ```
   */
  export class Trend {
    /** Create a new Trend metric */
    constructor(name: string, isTime?: boolean);
    /** Add a value to calculate statistics from */
    add(value: number, tags?: { [key: string]: string }): void;
    /** Metric name */
    readonly name: string;
  }
}

/**
 * k6 WebSocket Module - WebSocket client for real-time testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-ws/
 */
declare module "k6/ws" {
  /**
   * WebSocket connection parameters
   */
  export interface WSParams {
    /** Request headers */
    headers?: { [key: string]: string };
    /** Tags for metrics */
    tags?: { [key: string]: string };
    /** Compression mode */
    compression?: string;
  }

  /**
   * WebSocket socket instance
   */
  export interface Socket {
    /** Close the WebSocket connection */
    close(code?: number): void;
    /** Register a handler for events */
    on(event: "open" | "message" | "ping" | "pong" | "close" | "error", callback: (data?: any) => void): void;
    /** Send data through the WebSocket */
    send(data: string): void;
    /** Send binary data */
    sendBinary(data: ArrayBuffer): void;
    /** Send a ping */
    ping(): void;
    /** Set a timeout callback */
    setTimeout(callback: () => void, timeout: number): void;
    /** Set an interval callback */
    setInterval(callback: () => void, interval: number): void;
  }

  /**
   * WebSocket connection response
   */
  export interface WSResponse {
    /** HTTP status code of the upgrade response */
    status: number;
    /** Response headers */
    headers: { [key: string]: string };
    /** Body from the upgrade response */
    body: string;
    /** Error message if connection failed */
    error: string;
    /** URL of the connection */
    url: string;
  }

  /**
   * Connect to a WebSocket server.
   * @param url - WebSocket URL (ws:// or wss://)
   * @param params - Connection parameters
   * @param callback - Callback function receiving the socket
   * @returns WebSocket response object
   * @example
   * ```javascript
   * const res = ws.connect("wss://echo.websocket.org", {}, function(socket) {
   *   socket.on("open", () => socket.send("Hello!"));
   *   socket.on("message", (msg) => console.log(msg));
   *   socket.on("close", () => console.log("Disconnected"));
   * });
   * ```
   */
  export function connect(url: string, params: WSParams, callback: (socket: Socket) => void): WSResponse;
  export function connect(url: string, callback: (socket: Socket) => void): WSResponse;

  /** Default WebSocket module export */
  const ws: {
    connect: typeof connect;
  };
  export default ws;
}

/**
 * k6 gRPC Module - gRPC client for performance testing
 * https://grafana.com/docs/k6/latest/javascript-api/k6-net-grpc/
 */
declare module "k6/net/grpc" {
  /**
   * gRPC connection parameters
   */
  export interface GRPCParams {
    /** Metadata to send with requests */
    metadata?: { [key: string]: string };
    /** Tags for metrics */
    tags?: { [key: string]: string };
    /** Request timeout */
    timeout?: string | number;
  }

  /**
   * gRPC response object
   */
  export interface GRPCResponse {
    /** Response status code */
    status: number;
    /** Response message (parsed) */
    message: any;
    /** Response headers */
    headers: { [key: string]: string };
    /** Response trailers */
    trailers: { [key: string]: string };
    /** Error if request failed */
    error: any;
  }

  /**
   * gRPC stream object for streaming calls
   */
  export interface Stream {
    /** Register event handlers */
    on(event: "data" | "error" | "end", callback: (data?: any) => void): void;
    /** Write data to the stream (client streaming) */
    write(message: object): void;
    /** Signal end of client stream */
    end(): void;
  }

  /**
   * gRPC client for making RPC calls
   */
  export class Client {
    /** Create a new gRPC client */
    constructor();
    /** Load protobuf definitions */
    load(importPaths: string[], protoFiles: string | string[]): void;
    /** Load protobuf definitions from binary */
    loadProtoset(protosetPath: string): void;
    /** Connect to a gRPC server */
    connect(address: string, options?: { plaintext?: boolean; reflect?: boolean; timeout?: string | number; maxReceiveSize?: number; maxSendSize?: number; tls?: { cert?: string; key?: string; cacerts?: string; insecure?: boolean } }): void;
    /** Invoke a unary RPC method */
    invoke(method: string, request: object, params?: GRPCParams): GRPCResponse;
    /** Invoke an async unary RPC method (k6 v0.49.0+) */
    asyncInvoke(method: string, request: object, params?: GRPCParams): Promise<GRPCResponse>;
    /** Close the client connection */
    close(): void;
  }

  /**
   * gRPC status codes
   */
  export const StatusOK: number;
  export const StatusCancelled: number;
  export const StatusUnknown: number;
  export const StatusInvalidArgument: number;
  export const StatusDeadlineExceeded: number;
  export const StatusNotFound: number;
  export const StatusAlreadyExists: number;
  export const StatusPermissionDenied: number;
  export const StatusResourceExhausted: number;
  export const StatusFailedPrecondition: number;
  export const StatusAborted: number;
  export const StatusOutOfRange: number;
  export const StatusUnimplemented: number;
  export const StatusInternal: number;
  export const StatusUnavailable: number;
  export const StatusDataLoss: number;
  export const StatusUnauthenticated: number;

  /** Default gRPC module export */
  const grpc: {
    Client: typeof Client;
    StatusOK: typeof StatusOK;
    StatusCancelled: typeof StatusCancelled;
    StatusUnknown: typeof StatusUnknown;
    StatusInvalidArgument: typeof StatusInvalidArgument;
    StatusDeadlineExceeded: typeof StatusDeadlineExceeded;
    StatusNotFound: typeof StatusNotFound;
    StatusAlreadyExists: typeof StatusAlreadyExists;
    StatusPermissionDenied: typeof StatusPermissionDenied;
    StatusResourceExhausted: typeof StatusResourceExhausted;
    StatusFailedPrecondition: typeof StatusFailedPrecondition;
    StatusAborted: typeof StatusAborted;
    StatusOutOfRange: typeof StatusOutOfRange;
    StatusUnimplemented: typeof StatusUnimplemented;
    StatusInternal: typeof StatusInternal;
    StatusUnavailable: typeof StatusUnavailable;
    StatusDataLoss: typeof StatusDataLoss;
    StatusUnauthenticated: typeof StatusUnauthenticated;
  };
  export default grpc;
}

declare type ReadStream = any;

// === Supercheck Global Functions ===

/**
 * Configuration options for variable and secret retrieval functions.
 * 
 * @template T - The expected type of the default value
 */
interface VariableOptions<T = any> {
  /** 
   * Default value to return if the variable is not defined.
   * The type of this value determines the return type when no explicit type is specified.
   */
  default?: T;
  
  /** 
   * Whether the variable is required. If true, throws an error when the variable is not found.
   * @default false
   */
  required?: boolean;
  
  /** 
   * Explicit type conversion for the variable value.
   * - 'string': Returns the value as a string
   * - 'number': Parses the value as a number (throws if invalid)
   * - 'boolean': Converts to boolean ('true'/'1' → true, others → false)
   */
  type?: 'string' | 'number' | 'boolean';
}

/**
 * Retrieves a project variable value with comprehensive type safety and validation.
 * 
 * Project variables are stored in plain text and are suitable for non-sensitive
 * configuration values such as URLs, timeouts, environment names, and public settings.
 * These values can be safely logged and are visible in test outputs.
 * 
 * @param key - The variable key name as defined in project settings
 * @param options - Configuration options for retrieval and type conversion
 * @returns The variable value with appropriate type conversion applied
 * 
 * @throws {Error} When `options.required` is true and the variable is not defined
 * @throws {Error} When type conversion fails (e.g., invalid number format)
 * 
 * @example Basic usage with string return type
 * ```typescript
 * const baseUrl = getVariable('BASE_URL');
 * const environment = getVariable('ENV', { default: 'development' });
 * ```
 * 
 * @example Type conversion with validation
 * ```typescript
 * const timeout = getVariable('TIMEOUT', { 
 *   type: 'number', 
 *   default: 5000 
 * });
 * const debugMode = getVariable('DEBUG_MODE', { 
 *   type: 'boolean', 
 *   default: false 
 * });
 * ```
 * 
 * @example Required variables with error handling
 * ```typescript
 * try {
 *   const apiUrl = getVariable('API_URL', { required: true });
 *   await page.goto(apiUrl);
 * } catch (error) {
 *   throw new Error(`Missing required variable: ${error.message}`);
 * }
 * ```
 * 
 * @see {@link getSecret} For sensitive values like passwords and API keys
 */
declare function getVariable<T = string>(
  key: string,
  options?: VariableOptions<T>
): T extends number ? number : T extends boolean ? boolean : string;

/**
 * Retrieves a project secret value.
 * 
 * Project secrets are encrypted at rest using AES-128 encryption and are designed
 * for sensitive values such as passwords, API keys, tokens, and database credentials.
 * Values are resolved at runtime and execution output is redacted to avoid accidental exposure.
 * 
 * @param key - The secret key name as defined in project settings
 * @param options - Configuration options for retrieval and type conversion
 * @returns Secret value with optional type conversion
 * 
 * @throws {Error} When `options.required` is true and the secret is not defined
 * @throws {Error} When type conversion fails (e.g., invalid number format)
 * @throws {Error} When decryption fails due to invalid encryption key or corrupted data
 * 
 * @example Basic usage
 * ```typescript
 * const password = getSecret('USER_PASSWORD');
 * const apiToken = getSecret('API_TOKEN');
 *
 * // Works seamlessly with Playwright and other APIs
 * await page.fill('#password', password);
 * await page.setExtraHTTPHeaders({
 *   'Authorization': `Bearer ${apiToken}`
 * });
 * ```
 * 
 * @example Explicit type conversion
 * ```typescript
 * const apiKey = getSecret('API_KEY', { type: 'string' });
 * const dbPort = getSecret('DB_PORT', { type: 'number' });
 * const sslEnabled = getSecret('SSL_ENABLED', { type: 'boolean' });
 *
 * console.log(typeof apiKey);    // "string"
 * console.log(typeof dbPort);    // "number"
 * console.log(typeof sslEnabled); // "boolean"
 * ```
 * 
 * @example Error handling and fallbacks
 * ```typescript
 * const dbPassword = getSecret('DB_PASSWORD', {
 *   required: true,
 *   default: 'fallback-password' // Not recommended for production
 * });
 *
 * try {
 *   const token = getSecret('OPTIONAL_TOKEN');
 *   if (token) {
 *     // Token exists, use it
 *   }
 * } catch (error) {
 *   console.error('Failed to retrieve secret:', error.message);
 * }
 * ```
 * 
 * @security
 * - Secrets are encrypted using AES-128-GCM with project-specific context
 * - Secret values are not embedded in generated script source
 * - Runtime console output and execution logs are redacted
 * - No secret values are ever sent to the browser UI from variable APIs
 * 
 * @see {@link getVariable} For non-sensitive configuration values
 */
declare function getSecret<T = string>(
  key: string,
  options?: VariableOptions<T>
): T extends number ? number
  : T extends boolean ? boolean
  : string;

// === File Variables ===

/**
 * Returns the container file path for a file-type variable.
 *
 * File variables allow you to upload CSV, JSON, or text files as project
 * variables and access them at runtime in your test scripts. The file is
 * downloaded from storage and placed in the execution container before the
 * test runs.
 *
 * @param key - The variable key (case-sensitive, matches the key defined in Project Settings > Variables)
 * @returns The absolute path to the file inside the execution container
 * @throws Error if the file variable key is not defined
 *
 * @example Use with k6's open() in init context
 * ```typescript
 * const k6CsvContent = open(getFile('TEST_DATA'));
 * const rows = k6CsvContent.split('\n').slice(1);
 * ```
 *
 * @example Pass the resolved path to another helper
 * ```typescript
 * const filePath = getFile('TEST_DATA');
 * ```
 *
 * @see {@link readFile} For Playwright convenience reads
 * @see {@link getVariable} For plain-text configuration values
 * @see {@link getSecret} For sensitive values like passwords and API keys
 */
declare function getFile(key: string): string;

/**
 * Returns the contents of a file-type variable as a string in Playwright tests.
 *
 * Reads the uploaded file and returns its contents directly. The `fs` module
 * is never exposed to Playwright user scripts — this helper handles the I/O
 * internally.
 *
 * k6 performance scripts should use `open(getFile(key))` during init context
 * instead, and wrap parsed datasets in `SharedArray` when multiple VUs reuse
 * the same file.
 *
 * @param key - The variable key (case-sensitive, matches the key defined in Project Settings > Variables)
 * @param encoding - Optional encoding (default: 'utf-8')
 * @returns The file contents as a string
 * @throws Error if the file variable key is not defined
 *
 * @example Read a CSV file
 * ```typescript
 * const playwrightCsvContent = readFile('TEST_DATA');
 * const rows = playwrightCsvContent.split('\n').slice(1); // skip header
 * ```
 *
 * @example Parse a JSON data file
 * ```typescript
 * const config = JSON.parse(readFile('CONFIG'));
 * ```
 *
 * @see {@link getFile} For getting the raw file path
 */
declare function readFile(key: string, encoding?: string): string;

// === Async Utilities ===

/**
 * Executes a function after a specified delay
 * @param callback Function to execute
 * @param ms Delay in milliseconds
 * @returns Timer ID that can be used with clearTimeout
 */
declare function setTimeout(callback: () => void, ms: number): number;

/**
 * Executes a function repeatedly with a fixed time delay
 * @param callback Function to execute
 * @param ms Interval in milliseconds
 * @returns Timer ID that can be used with clearInterval
 */
declare function setInterval(callback: () => void, ms: number): number;

/**
 * Cancels a timeout previously established by calling setTimeout
 * @param id Timer ID returned by setTimeout
 */
declare function clearTimeout(id: number): void;

/**
 * Cancels an interval previously established by calling setInterval
 * @param id Timer ID returned by setInterval
 */
declare function clearInterval(id: number): void;

// === Type Guards and Utilities ===

/**
 * Type guard to check if a value is a string
 */
declare function isString(value: any): value is string;

/**
 * Type guard to check if a value is a number
 */
declare function isNumber(value: any): value is number;

/**
 * Type guard to check if a value is a boolean
 */
declare function isBoolean(value: any): value is boolean;

/**
 * Type guard to check if a value is an object
 */
declare function isObject(value: any): value is object;

/**
 * Type guard to check if a value is an array
 */
declare function isArray(value: any): value is any[];

/**
 * Sleep function for adding delays in tests
 * @param ms Milliseconds to wait
 * @returns Promise that resolves after the specified time
 * 
 * @example
 * ```typescript
 * // Wait for 2 seconds
 * await sleep(2000);
 * ```
 */
declare function sleep(ms: number): Promise<void>;
