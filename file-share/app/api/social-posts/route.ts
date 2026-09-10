import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { createSocialPost, listSocialPosts } from '@/lib/social-posts';
import { errorResponse, HttpError } from '@/lib/http';

export async function GET() {
  try {
    if (!await isAuthenticated()) throw new HttpError(401, 'Unauthorized');
    return NextResponse.json({ success: true, data: await listSocialPosts() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error, 'Could not load social posts'); }
}

export async function POST(request: Request) {
  try {
    if (!await isAuthenticated()) throw new HttpError(401, 'Unauthorized');
    return NextResponse.json({ success: true, data: await createSocialPost(request) }, { status: 201 });
  } catch (error) {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => {});
    return errorResponse(error, 'Could not create social post');
  }
}

export const runtime = 'nodejs';
