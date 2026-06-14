import { NextRequest, NextResponse } from 'next/server';

const INTERNAL_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const targetUrl = `${INTERNAL_API_BASE_URL}/announcements${request.nextUrl.search}`;
  const upstream = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      Accept: request.headers.get('accept') ?? 'application/json'
    },
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
