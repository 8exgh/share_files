import { NextResponse } from 'next/server';
import { listAnonymousFiles, saveAnonymousFile } from '@/lib/anonymous-files';
import { errorResponse } from '@/lib/http';

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await listAnonymousFiles() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'Could not load anonymous files'); }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json({ success: true, data: await saveAnonymousFile(request) }, { status: 201 });
  } catch (error) {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    return errorResponse(error, 'Could not upload file');
  }
}

export const runtime = 'nodejs';
