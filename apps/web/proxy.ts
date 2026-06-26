import { NextResponse, type NextRequest } from 'next/server';
import { isPublicRoute, normalizePublicLanguage, publicLanguageHeader } from './app/lib/public-language-routing';
type ProfileResponse = {
  user: {
    role?: string | null;
  };
};

const INTERNAL_API_BASE_URL = (
  process.env.INTERNAL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://127.0.0.1:3001'
).replace(/\/+$/, '');

const MERCHANT_ROLES = new Set(['admin', 'merchant']);

const USER_SITE_PATHS = [
  '/',
  '/account',
  '/experience',
  '/log',
  '/models',
  '/token'
];

const MERCHANT_SITE_PATHS = ['/admin', '/merchant'];
const REMOVED_USER_PATHS = ['/groupAvailability', '/midjourney', '/task'];
const REMOVED_MERCHANT_PATHS = ['/merchant/drawing-logs'];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!requiresAccountRouting(pathname)) {
    const publicLanguageResponse = getPublicLanguageResponse(request);
    if (publicLanguageResponse) {
      return publicLanguageResponse;
    }
    return NextResponse.next();
  }

  const profile = await getProfile(request);
  const role = profile?.user.role;
  const isMerchant = isMerchantRole(role);
  const isLoggedIn = Boolean(profile);

  if (isLoggedIn && !isMerchant && pathname === '/') {
    const redirectUrl = new URL('/account', request.url);
    copyLanguageSearchParams(request, redirectUrl);
    return NextResponse.redirect(redirectUrl);
  }

  if (!isLoggedIn) {
    const publicLanguageResponse = getPublicLanguageResponse(request);
    if (publicLanguageResponse) {
      return publicLanguageResponse;
    }
  }

  if (isRemovedUserPath(pathname)) {
    return NextResponse.redirect(new URL(isMerchant ? '/merchant' : isLoggedIn ? '/account/profile' : '/login', request.url));
  }

  if (isRemovedMerchantPath(pathname)) {
    return NextResponse.redirect(new URL(isMerchant ? '/merchant' : isLoggedIn ? '/account/profile' : '/login', request.url));
  }

  if (isMerchant && pathname === '/admin') {
    return NextResponse.redirect(new URL('/merchant', request.url));
  }

  if (isMerchant && (isUserSitePath(pathname) || pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/merchant', request.url));
  }

  if (isLoggedIn && !isMerchant && isMerchantSitePath(pathname)) {
    return NextResponse.redirect(new URL('/account/profile', request.url));
  }

  if (!isLoggedIn && isMerchantSitePath(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isLoggedIn && !isMerchant && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/account/profile', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api/|_next/|.*\\..*).*)'
  ]
};

function getPublicLanguageResponse(request: NextRequest) {
  if (!isPublicRoute(request.nextUrl.pathname)) {
    return null;
  }

  const requestedLanguage =
    request.nextUrl.searchParams.get('language') ??
    request.nextUrl.searchParams.get('lang') ??
    request.nextUrl.searchParams.get('locale');
  if (!requestedLanguage) {
    return null;
  }

  return NextResponse.next({
    request: {
      headers: withLanguageHeader(request, normalizePublicLanguage(requestedLanguage))
    }
  });
}

function withLanguageHeader(request: NextRequest, language: string) {
  const headers = new Headers(request.headers);
  headers.set(publicLanguageHeader, language);
  return headers;
}

function copyLanguageSearchParams(request: NextRequest, targetUrl: URL) {
  for (const key of ['language', 'lang', 'locale']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) {
      targetUrl.searchParams.set(key, value);
      return;
    }
  }
}

async function getProfile(request: NextRequest) {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return null;
  }

  const response = await fetch(`${INTERNAL_API_BASE_URL}/auth/me`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Cookie: cookie
    }
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as ProfileResponse | null;
}

function isMerchantRole(role: string | null | undefined) {
  return MERCHANT_ROLES.has((role ?? '').trim().toLowerCase());
}

function isUserSitePath(pathname: string) {
  return USER_SITE_PATHS.some((prefix) => pathname === prefix || (prefix !== '/' && pathname.startsWith(`${prefix}/`)));
}

function isMerchantSitePath(pathname: string) {
  return MERCHANT_SITE_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isRemovedUserPath(pathname: string) {
  return REMOVED_USER_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isRemovedMerchantPath(pathname: string) {
  return REMOVED_MERCHANT_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function requiresAccountRouting(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/register' ||
    isUserSitePath(pathname) ||
    isMerchantSitePath(pathname) ||
    isRemovedUserPath(pathname) ||
    isRemovedMerchantPath(pathname)
  );
}
