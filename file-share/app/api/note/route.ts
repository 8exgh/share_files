import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { saveNote } from '@/lib/storage';
import { ApiResponse, UploadedFile } from '@/types';
import { errorResponse, HttpError, readJsonBody } from '@/lib/http';
import { MAX_NOTE_SIZE } from '@/lib/security-config';

export async function POST(request: NextRequest) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    const body = await readJsonBody(request, MAX_NOTE_SIZE + 8192);
    const { content, name } = body;
    if (name !== undefined && (typeof name !== 'string' || name.length > 255)) {
      throw new HttpError(400, 'Note name must be a string of at most 255 characters');
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Note content is required'
      }, { status: 400 });
    }

    const uploadedFile = await saveNote(content, name);

    return NextResponse.json<ApiResponse<UploadedFile>>({
      success: true,
      data: uploadedFile,
      message: 'Note created successfully'
    });
  } catch (error) {
    return errorResponse(error, 'An error occurred while creating the note');
  }
}
