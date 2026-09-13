import { NextResponse } from 'next/server';
import { saveAnonymousNote } from '@/lib/anonymous-files';
import { errorResponse } from '@/lib/http';

export async function POST(request: Request) {
  try {
    return NextResponse.json({ success: true, data: await saveAnonymousNote(request) }, { status: 201 });
  } catch (error) {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    return errorResponse(error, 'Could not create note');
  }
}

export const runtime = 'nodejs';
