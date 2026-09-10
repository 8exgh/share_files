import { NextRequest } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { openSocialAsset } from '@/lib/social-posts';
import { downloadStream } from '@/lib/download';
import { reserveDownload } from '@/lib/transfers';
import { errorResponse, HttpError } from '@/lib/http';

type Context = { params: Promise<{ id: string }> };

async function serve(request: NextRequest, { params }: Context, head: boolean) {
  let release: (() => void) | undefined;
  let file: Awaited<ReturnType<typeof openSocialAsset>> | undefined;
  try {
    if (!await isAuthenticated()) throw new HttpError(401, 'Unauthorized');
    const { id } = await params;
    release = reserveDownload();
    file = await openSocialAsset(id);
    const headers: Record<string, string> = {
      'Content-Type': file.asset.mimeType,
      'Content-Disposition': `${request.nextUrl.searchParams.has('download') ? 'attachment' : 'inline'}; filename="${file.asset.filename}"`,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    let range: { start: number; end: number } | undefined;
    // Browsers use byte ranges to preview and seek videos. Unsupported multi-ranges
    // are ignored, returning the full representation as permitted by HTTP.
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
    if (match) {
      const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
      if ((!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
        throw new HttpError(416, 'Requested range is not available', { 'Content-Range': `bytes */${file.size}` });
      }
      range = { start, end };
      headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
      headers['Content-Length'] = String(end - start + 1);
    }
    if (head) {
      await file.handle.close(); release();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    return new Response(downloadStream(file.handle, request.signal, release, range), { status: range ? 206 : 200, headers });
  } catch (error) {
    try { await file?.handle.close(); } finally { release?.(); }
    return errorResponse(error, 'Could not load attachment');
  }
}

export const GET = (request: NextRequest, context: Context) => serve(request, context, false);
export const HEAD = (request: NextRequest, context: Context) => serve(request, context, true);
export const runtime = 'nodejs';
