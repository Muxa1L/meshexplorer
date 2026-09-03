import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';

/** Pages that stay reachable without authentication. */
const PUBLIC_PAGES = new Set(['/login', '/register']);

/**
 * Static files served from /public that never require authentication.
 * (Next.js assets under /_next are already excluded by the matcher.)
 */
const PUBLIC_FILE_PATTERN = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|txt|xml|webmanifest|woff2?|ttf|otf)$/i;

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // ─── API routes: keep the public CORS behaviour ─────────────────────────
    // Authentication-sensitive auth routes (/api/auth/*) enforce their own
    // session/admin checks inside the route handlers.
    if (pathname.startsWith('/api/')) {
        // Handle preflight requests
        if (request.method === 'OPTIONS') {
            return new NextResponse(null, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
                    'Access-Control-Allow-Credentials': 'true',
                },
            });
        }

        // For non-OPTIONS requests, get the response and add CORS headers
        const response = NextResponse.next();

        // Allow all origins for development
        response.headers.set('Access-Control-Allow-Origin', '*');

        // Allow common HTTP methods
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

        // Allow common headers
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

        // Allow credentials if needed
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        return response;
    }

    // ─── Static assets: always public ───────────────────────────────────────
    if (PUBLIC_FILE_PATTERN.test(pathname)) {
        return NextResponse.next();
    }

    // ─── Page routes: require a valid session ───────────────────────────────
    const session = await getSessionFromRequest(request);

    // Signed-in users never see the auth pages again
    if (PUBLIC_PAGES.has(pathname)) {
        if (session) {
            return NextResponse.redirect(new URL('/', request.url));
        }
        return NextResponse.next();
    }

    // Everything else requires authentication
    if (!session) {
        const loginUrl = new URL('/login', request.url);
        if (pathname !== '/') {
            loginUrl.searchParams.set('from', pathname);
        }
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    // Run on everything except Next.js internal assets
    matcher: '/((?!_next/|favicon\\.ico).*)',
};