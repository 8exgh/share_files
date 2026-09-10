import { NextRequest, NextResponse } from 'next/server';
import { openFile } from '@/lib/storage';
import { downloadStream } from '@/lib/download';
import { reserveDownload } from '@/lib/transfers';
import { errorResponse } from '@/lib/http';
import mime from 'mime-types';

type RouteContext = { params: Promise<{ uuid: string; filename: string }> };

async function serve(request: NextRequest, { params }: RouteContext, head: boolean) {
  let release: (() => void) | undefined;
  let file: Awaited<ReturnType<typeof openFile>> = null;
  try {
    const { uuid, filename } = await params;
    release = reserveDownload();
    // Next already decodes route parameters. Accept only the stored filename.
    file = await openFile(uuid, filename);
    if (!file) { release(); return new NextResponse('File not found', { status: 404 }); }
    const headers = {
      'Content-Type': mime.lookup(file.filename) || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (head) {
      await file.handle.close(); release();
      return new Response(null, { headers });
    }
    return new Response(downloadStream(file.handle, request.signal, release), { headers });
  } catch (error) {
    try { await file?.handle.close(); } finally { release?.(); }
    return errorResponse(error, 'An error occurred during download');
  }
}

export const GET = (request: NextRequest, context: RouteContext) => serve(request, context, false);
export const HEAD = (request: NextRequest, context: RouteContext) => serve(request, context, true);
