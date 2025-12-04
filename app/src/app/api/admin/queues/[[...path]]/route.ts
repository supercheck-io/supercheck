import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import ejs from "ejs";

import { NextBullBoardAdapter } from "@/lib/bull-board/next-adapter";
import { getQueues } from "@/lib/queue";
import { getCurrentUser } from "@/lib/session";
import { Role } from "@/lib/rbac/permissions";

import type { NextBullBoardAdapterState } from "@/lib/bull-board/next-adapter";

// Configuration constants
const BULL_BOARD_BASE_PATH = "/api/admin/queues";
const STATIC_CACHE_MAX_AGE = 31536000; // 1 year for immutable assets
const INIT_TIMEOUT_MS = 30000; // 30 second timeout for initialization

const serverAdapter = new NextBullBoardAdapter().setBasePath(
  BULL_BOARD_BASE_PATH
);

let bullBoardInitialized = false;
let cachedState: NextBullBoardAdapterState | null = null;
let initializationPromise: Promise<NextBullBoardAdapterState> | null = null;

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

/**
 * Initialize Bull Board with proper singleton pattern and timeout handling.
 * Uses a promise-based mutex to prevent race conditions during initialization.
 */
const ensureBullBoard = async (): Promise<NextBullBoardAdapterState> => {
  // Return cached state if already initialized
  if (bullBoardInitialized && cachedState) {
    return cachedState;
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    return initializationPromise;
  }

  // Start initialization with timeout
  initializationPromise = Promise.race([
    initializeBullBoard(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new HttpError(503, "Bull Board initialization timed out")),
        INIT_TIMEOUT_MS
      )
    ),
  ]).catch((error) => {
    // Reset initialization promise on failure
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
};

/**
 * Core initialization logic for Bull Board.
 * Separated from ensureBullBoard for cleaner error handling.
 */
const initializeBullBoard = async (): Promise<NextBullBoardAdapterState> => {
  const {
    playwrightQueues,
    k6Queues,
    monitorExecutionQueue,
    jobSchedulerQueue,
    k6JobSchedulerQueue,
    monitorSchedulerQueue,
    emailTemplateQueue,
    dataLifecycleCleanupQueue,
  } = await getQueues();

  createBullBoard({
    queues: [
      ...Object.entries(playwrightQueues).map(
        ([region, queue]) =>
          new BullMQAdapter(queue, {
            displayName: `Playwright Execution (${region})`,
          })
      ),
      ...Object.entries(k6Queues).map(
        ([region, queue]) =>
          new BullMQAdapter(queue, { displayName: `k6 Execution (${region})` })
      ),
      ...Object.entries(monitorExecutionQueue).map(
        ([region, queue]) =>
          new BullMQAdapter(queue, {
            displayName: `Monitor Execution (${region})`,
          })
      ),
      new BullMQAdapter(jobSchedulerQueue, {
        displayName: "Playwright Job Scheduler",
      }),
      new BullMQAdapter(k6JobSchedulerQueue, {
        displayName: "K6 Job Scheduler",
      }),
      new BullMQAdapter(monitorSchedulerQueue, {
        displayName: "Monitor Scheduler",
      }),
      new BullMQAdapter(emailTemplateQueue, {
        displayName: "Email Template Render",
      }),
      new BullMQAdapter(dataLifecycleCleanupQueue, {
        displayName: "Data Lifecycle Cleanup",
      }),
    ],
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: "Bull Dashboard",
      },
    },
  });

  cachedState = serverAdapter.getState();
  bullBoardInitialized = true;
  initializationPromise = null;

  return cachedState;
};

const createNotFoundResponse = () =>
  NextResponse.json({ error: "Not found" }, { status: 404 });

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
} as const;

const DEFAULT_MIME_TYPE = "application/octet-stream";

const getMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] ?? DEFAULT_MIME_TYPE;
};

const toBodyInit = (value: string | Uint8Array): BodyInit => {
  if (typeof value === "string") {
    return value;
  }

  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer;
};

const safeJoin = (basePath: string, relativePath: string): string => {
  const normalizedRelative = relativePath.replace(/^[\\/]+/, "");
  const fullPath = path.resolve(basePath, normalizedRelative);
  if (!fullPath.startsWith(path.resolve(basePath))) {
    throw new HttpError(404, "File not found");
  }

  return fullPath;
};

const serveStaticAsset = async (
  requestPath: string,
  method: string,
  state: NextBullBoardAdapterState
): Promise<NextResponse | null> => {
  const { staticRoute, staticPath } = state;
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }

  const normalizedRoute =
    staticRoute === "/" ? "/" : `${staticRoute.replace(/\/+$/, "")}/`;

  if (
    requestPath !== staticRoute &&
    requestPath !== `${staticRoute}/` &&
    !requestPath.startsWith(normalizedRoute)
  ) {
    return null;
  }

  const relativePath =
    requestPath.length > staticRoute.length
      ? requestPath.slice(normalizedRoute.length)
      : "";

  try {
    const filePath = safeJoin(staticPath, relativePath || "index.html");
    const file = await fs.readFile(filePath);
    const mimeType = getMimeType(filePath);

    const headers = new Headers({
      "Content-Type": mimeType,
      "Cache-Control": `public, max-age=${STATIC_CACHE_MAX_AGE}, immutable`,
    });

    if (method === "HEAD") {
      headers.set("Content-Length", file.length.toString());
      return new NextResponse(null, { status: 200, headers });
    }

    return new NextResponse(file, { status: 200, headers });
  } catch (error) {
    console.error("[Bull-Board] Static asset error:", error);
    return createNotFoundResponse();
  }
};

const renderEntryRoute = async (
  requestPath: string,
  method: string,
  state: NextBullBoardAdapterState
): Promise<NextResponse | null> => {
  const { entryRoute, uiConfig, basePath, viewsPath } = state;
  if (method !== entryRoute.method) {
    return null;
  }

  for (const matcher of entryRoute.matchers) {
    const match = matcher.match(requestPath);
    if (!match) {
      continue;
    }

    const { name, params } = entryRoute.handler({
      basePath,
      uiConfig,
    });

    const templatePath = path.join(viewsPath, name);
    const html = await ejs.renderFile(templatePath, params, { async: true });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return null;
};

const parseRequestBody = async (
  request: NextRequest
): Promise<Record<string, unknown>> => {
  if (request.method === "GET" || request.method === "HEAD") {
    return {};
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      throw new HttpError(400, "Invalid JSON payload");
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const body: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        body[key] = value;
      }
    }
    return body;
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const body: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      body[key] = value;
    }
    return body;
  }

  const text = await request.text();
  return text ? { raw: text } : {};
};

const handleApiRoute = async (
  requestPath: string,
  method: string,
  state: NextBullBoardAdapterState,
  request: NextRequest
): Promise<NextResponse | null> => {
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const headers = Object.fromEntries(
    Array.from(request.headers.entries()).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );

  for (const route of state.apiRoutes) {
    if (!route.methods.has(method)) {
      continue;
    }

    for (const matcher of route.matchers) {
      const match = matcher.match(requestPath);
      if (!match) {
        continue;
      }

      let body: Record<string, unknown> = {};
      try {
        body = await parseRequestBody(request);
      } catch (error) {
        const handled = state.errorHandler(
          error instanceof Error ? error : new HttpError(400, "Bad Request")
        );

        const status = handled.status ?? 400;
        const responseBody = handled.body ?? { error: "Bad Request" };
        return NextResponse.json(responseBody, { status });
      }

      try {
        const result = await route.handler({
          queues: state.queues,
          query,
          params: match.params,
          body,
          headers,
        });

        const status = result?.status ?? 200;
        const responseBody = result?.body;

        if (responseBody === undefined || responseBody === null) {
          return new NextResponse(null, { status });
        }

        if (typeof responseBody === "string") {
          return new NextResponse(responseBody, {
            status,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          });
        }

        if (responseBody instanceof Uint8Array) {
          return new NextResponse(toBodyInit(responseBody), {
            status,
            headers: {
              "Content-Type": "application/octet-stream",
            },
          });
        }

        return NextResponse.json(responseBody, { status });
      } catch (error) {
        console.error("[Bull-Board] API route error:", error);
        const handled = state.errorHandler(
          error instanceof Error
            ? error
            : new Error("Bull Board handler failed")
        );

        const status = handled.status ?? 500;
        const responseBody = handled.body ?? { error: "Internal Server Error" };
        return NextResponse.json(responseBody, { status });
      }
    }
  }

  return null;
};

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== Role.SUPER_ADMIN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch (error) {
    console.error("[Bull-Board] Auth error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }

  let state: NextBullBoardAdapterState;
  try {
    state = await ensureBullBoard();
  } catch (error) {
    console.error("[Bull-Board] Initialization error:", error);
    return NextResponse.json(
      { error: "Failed to initialize Bull Board" },
      { status: 500 }
    );
  }

  const resolvedParams = await params;
  const pathSegments = resolvedParams.path || [];
  const requestPath =
    pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "/";
  const method = request.method.toUpperCase();

  const staticResponse = await serveStaticAsset(requestPath, method, state);
  if (staticResponse) {
    return staticResponse;
  }

  const viewResponse = await renderEntryRoute(requestPath, method, state);
  if (viewResponse) {
    return viewResponse;
  }

  const apiResponse = await handleApiRoute(requestPath, method, state, request);
  if (apiResponse) {
    return apiResponse;
  }

  return createNotFoundResponse();
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
