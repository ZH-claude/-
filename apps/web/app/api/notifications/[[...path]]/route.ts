import { NextRequest, NextResponse } from 'next/server';

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return forward(request, context, 'PUT');
}

async function forward(request: NextRequest, context: RouteContext, method: 'GET' | 'POST' | 'PUT') {
  const { path = [] } = await context.params;
  const targetPath = path.length > 0 ? `/${path.map((segment) => encodeURIComponent(segment)).join('/')}` : '';
  const targetUrl = `${INTERNAL_API_BASE_URL}/notifications${targetPath}${request.nextUrl.search}`;
  const headers = new Headers({
    Accept: request.headers.get('accept') ?? 'application/json'
  });

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  const cookie = request.headers.get('cookie');
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: method === 'GET' ? undefined : await request.text(),
    cache: 'no-store',
    redirect: 'manual'
  });

  const responseBody = await upstream.text();
  const response = new NextResponse(responseBody || null, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });

  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) {
    response.headers.set('Set-Cookie', setCookie);
  }

  return response;
}
