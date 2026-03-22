import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { saveNote } from '@/lib/storage';
import { ApiResponse, UploadedFile } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    const body = await request.json();
    const { content, name } = body;

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
    console.error('[NOTE] error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred while creating the note'
    }, { status: 500 });
  }
}
