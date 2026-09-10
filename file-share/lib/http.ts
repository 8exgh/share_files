import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers?: Record<string, string>) {
    super(message);
  }
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof HttpError) {
    return NextResponse.json({ success: false, message: error.message }, {
      status: error.status, headers: error.headers,
    });
  }
  console.error(fallback, error);
  return NextResponse.json({ success: false, message: fallback }, { status: 500 });
}

// Count bytes while reading; Content-Length alone does not bound chunked bodies.
export async function readJsonBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new HttpError(413, 'Request body is too large');
  }
  if (!request.body) throw new HttpError(400, 'JSON body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 15_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, 'Request body is too large');
      }
      chunks.push(value);
    }
    if (timedOut) throw new HttpError(408, 'Request body timed out');
    const body: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'JSON body must be an object');
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body');
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
