import { NextRequest, NextResponse } from 'next/server';
import { hasValidBasicAuth, isAuthenticated } from '@/lib/auth';
import { saveFileStream } from '@/lib/storage';
import { errorResponse, HttpError } from '@/lib/http';
import { MAX_FILE_SIZE } from '@/lib/security-config';

export async function POST(request: NextRequest) {
  try {
    // A valid browser session does not need to spend the password-attempt budget.
    if (!await isAuthenticated() && !await hasValidBasicAuth(request.headers.get('authorization'))) {
      throw new HttpError(401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="File Share"' });
    }
    const contentType = request.headers.get('content-type') || '';
    if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
      throw new HttpError(400, 'Content-Type must be multipart/form-data');
    }
    if (!request.body) throw new HttpError(400, 'No file provided');
    if (Number(request.headers.get('content-length')) > MAX_FILE_SIZE + 64 * 1024) {
      throw new HttpError(413, 'Request body is too large');
    }
    const value = request.nextUrl.searchParams.get('autoDelete');
    if (value !== null && !/^(true|false)$/i.test(value)) throw new HttpError(400, 'autoDelete must be true or false');
    const file = await saveFileStream(request.body, contentType, value?.toLowerCase() !== 'false', request.signal);
    if (!file) throw new HttpError(400, 'No file provided');
    return NextResponse.json({ success: true, data: file, message: 'File uploaded successfully' });
  } catch (error) {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    return errorResponse(error, 'An error occurred during file upload');
  }
}

export const runtime = 'nodejs';
