import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to handle CORS for API routes.
 * 
 * This allows the OpenAPI documentation playground to make requests
 * to the API from different origins (e.g., localhost during development,
 * or docs subdomain in production).
 * 
 * CORS is only applied to /api/* routes and only for allowed origins.
 */

// Allowed origins for CORS
const getAllowedOrigins = (): string[] => {
  const origins = [
    // Development
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    // Production docs
    'https://demo.supercheck.dev',
    'https://supercheck.io',
    'https://docs.supercheck.io',
    'https://www.supercheck.io',
    // Future production
    'https://app.supercheck.io'
  ];
  
  // Add APP_URL if set
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    origins.push(appUrl);
  }
  
  // Add TRUSTED_ORIGINS if set
  const trustedOrigins = process.env.TRUSTED_ORIGINS;
  if (trustedOrigins) {
    const trusted = trustedOrigins.split(',').map(o => o.trim()).filter(Boolean);
    origins.push(...trusted);
  }
  
  return origins;
};

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const pathname = request.nextUrl.pathname;
  
  // Only apply CORS to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  
  const allowedOrigins = getAllowedOrigins();
  const isAllowedOrigin = origin && allowedOrigins.includes(origin);
  
  // Handle preflight requests (OPTIONS)
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    
    if (isAllowedOrigin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Project-Id');
    response.headers.set('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    response.headers.set('Vary', 'Origin');
    
    return response;
  }
  
  // For actual requests, add CORS headers
  const response = NextResponse.next();
  
  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  response.headers.set('Vary', 'Origin');
  
  return response;
}

// Only run middleware on API routes
export const config = {
  matcher: '/api/:path*',
};
