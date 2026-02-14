/**
 * Cloudflare Pages Function – API proxy for the OpenAPI playground.
 *
 * fumadocs-openapi sends playground requests to `/api/proxy?url=<encoded_url>`.
 * Because the docs site is a static export on Cloudflare Pages, we can't use a
 * Next.js API route. This edge function replaces the old `src/app/api/proxy/route.ts`
 * and mirrors the fumadocs `createProxy` protocol.
 */

const ALLOWED_ORIGINS = [
  'https://demo.supercheck.dev',
  'https://app.supercheck.io',
];

const PROXY_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];

interface CFContext {
  request: Request;
}

export async function onRequest(context: CFContext): Promise<Response> {
  const { request } = context;

  if (!PROXY_METHODS.includes(request.method)) {
    return Response.json('[Proxy] Method not allowed', { status: 405 });
  }

  const url = new URL(request.url).searchParams.get('url');

  if (!url) {
    return Response.json(
      '[Proxy] A `url` query parameter is required for proxy url',
      { status: 400 },
    );
  }

  const parsedUrl = URL.parse(url);

  if (!parsedUrl) {
    return Response.json('[Proxy] Invalid `url` parameter value.', {
      status: 400,
    });
  }

  if (!ALLOWED_ORIGINS.includes(parsedUrl.origin)) {
    return Response.json(
      `[Proxy] The origin "${parsedUrl.origin}" is not allowed.`,
      { status: 400 },
    );
  }

  const contentLength = request.headers.get('content-length');
  const hasBody = contentLength && parseInt(contentLength) > 0;

  const proxied = new Request(parsedUrl, {
    method: request.method,
    cache: 'no-cache',
    headers: request.headers,
    body:
      hasBody && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())
        ? await request.arrayBuffer()
        : undefined,
  });

  // Remove the browser origin so the upstream server doesn't reject the request
  proxied.headers.forEach((_value, key) => {
    if (key.toLowerCase() === 'origin') proxied.headers.delete(key);
  });

  let res: Response;
  try {
    res = await fetch(proxied);
  } catch (e) {
    return Response.json(
      `[Proxy] Failed to proxy request: ${String(e)}`,
      { status: 500 },
    );
  }

  // Strip upstream CORS headers – the Pages function will add its own
  const headers = new Headers(res.headers);
  headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith('access-control-')) headers.delete(key);
  });
  headers.set('X-Forwarded-Host', res.url);

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};
