import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { saveFileStream } from '@/lib/storage';
import { ApiResponse, UploadedFile } from '@/types';

export async function POST(request: NextRequest) {
  console.log('[UPLOAD] POST /api/upload hit');
  console.log('[UPLOAD] content-length:', request.headers.get('content-length'));
  console.log('[UPLOAD] content-type:', request.headers.get('content-type'));
  try {
    // Check authentication
    const authenticated = await isAuthenticated();
    console.log('[UPLOAD] authenticated:', authenticated);
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      console.log('[UPLOAD] rejected: not multipart/form-data');
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Content-Type must be multipart/form-data'
      }, { status: 400 });
    }

    if (!request.body) {
      console.log('[UPLOAD] rejected: no request.body');
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'No file provided'
      }, { status: 400 });
    }

    // Extract boundary from content-type
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      console.log('[UPLOAD] rejected: no boundary found');
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Invalid multipart boundary'
      }, { status: 400 });
    }
    console.log('[UPLOAD] boundary extracted, calling saveFileStream...');

    // Stream the request body to disk
    const uploadedFile = await saveFileStream(request.body, boundary);
    console.log('[UPLOAD] saveFileStream returned:', uploadedFile ? uploadedFile.filename : 'null');

    if (!uploadedFile) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'No file provided'
      }, { status: 400 });
    }

    console.log('[UPLOAD] success, file size:', uploadedFile.size);
    return NextResponse.json<ApiResponse<UploadedFile>>({
      success: true,
      data: uploadedFile,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('[UPLOAD] error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred during file upload'
    }, { status: 500 });
  }
}

export const runtime = 'nodejs';
