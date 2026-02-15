import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { saveFileStream } from '@/lib/storage';
import { ApiResponse, UploadedFile } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Content-Type must be multipart/form-data'
      }, { status: 400 });
    }

    if (!request.body) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'No file provided'
      }, { status: 400 });
    }

    // Extract boundary from content-type
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Invalid multipart boundary'
      }, { status: 400 });
    }

    // Stream the request body to disk
    const uploadedFile = await saveFileStream(request.body, boundary);

    if (!uploadedFile) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'No file provided'
      }, { status: 400 });
    }

    return NextResponse.json<ApiResponse<UploadedFile>>({
      success: true,
      data: uploadedFile,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred during file upload'
    }, { status: 500 });
  }
}

export const runtime = 'nodejs';
