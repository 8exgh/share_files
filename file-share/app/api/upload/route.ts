import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { saveFile } from '@/lib/storage';
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'No file provided'
      }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save file
    const uploadedFile = await saveFile(buffer, file.name);

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

export const config = {
  api: {
    bodyParser: false,
  },
};