import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { deleteSocialPost, updateSocialPost } from '@/lib/social-posts';
import { errorResponse, HttpError, readJsonBody } from '@/lib/http';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    if (!await isAuthenticated()) throw new HttpError(401, 'Unauthorized');
    const { id } = await params;
    const changes = await readJsonBody(request, 1024);
    return NextResponse.json({ success: true, data: await updateSocialPost(id, changes) });
  } catch (error) { return errorResponse(error, 'Could not update posting status'); }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    if (!await isAuthenticated()) throw new HttpError(401, 'Unauthorized');
    const { id } = await params;
    await deleteSocialPost(id);
    return NextResponse.json({ success: true });
  } catch (error) { return errorResponse(error, 'Could not delete social post'); }
}
