import { NextRequest, NextResponse } from 'next/server';

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type RouteContext = {
  params: Promise<{
    channel: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { channel } = await context.params;
  const targetUrl = `${INTERNAL_API_BASE_URL}/payment-notify/${encodeURIComponent(channel)}${request.nextUrl.search}`;
  const headers = new Headers({
    Accept: request.headers.get('accept') ?? 'application/json'
  });

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  const upstream = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: await request.text(),
    cache: 'no-store',
    redirect: 'manual'
  });

  const responseBody = await upstream.text();
  return new NextResponse(responseBody || null, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
