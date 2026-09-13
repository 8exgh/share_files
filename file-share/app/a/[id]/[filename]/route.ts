import { NextRequest } from 'next/server';
import { openAnonymousFile } from '@/lib/anonymous-files';
import { downloadStream } from '@/lib/download';
import { reserveDownload } from '@/lib/transfers';
import { errorResponse } from '@/lib/http';

type Context = { params: Promise<{ id: string; filename: string }> };

async function serve(request: NextRequest, { params }: Context, head: boolean) {
  let release: (() => void) | undefined;
  let opened: Awaited<ReturnType<typeof openAnonymousFile>> | undefined;
  try {
    const { id, filename } = await params;
    release = reserveDownload();
    opened = await openAnonymousFile(id, filename);
    const view = opened.file.kind === 'note' && request.nextUrl.searchParams.get('view') === '1';
    const headers = {
      'Content-Type': view ? 'text/plain; charset=utf-8' : 'application/octet-stream',
      'Content-Disposition': `${view ? 'inline' : 'attachment'}; filename="${filename}"`,
      'Content-Length': String(opened.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    };
    if (head) {
      await opened.handle.close(); release();
      return new Response(null, { headers });
    }
    return new Response(downloadStream(opened.handle, request.signal, release), { headers });
  } catch (error) {
    try { await opened?.handle.close(); } finally { release?.(); }
    return errorResponse(error, 'Could not read file');
  }
}

export const GET = (request: NextRequest, context: Context) => serve(request, context, false);
export const HEAD = (request: NextRequest, context: Context) => serve(request, context, true);
export const runtime = 'nodejs';
