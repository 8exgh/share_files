import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { listFiles } from '@/lib/storage';
import { ApiResponse, UploadedFile } from '@/types';

export async function GET() {
  try {
    // Check authentication
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    // Get list of files
    const files = await listFiles();

    return NextResponse.json<ApiResponse<UploadedFile[]>>({
      success: true,
      data: files
    });
  } catch (error) {
    console.error('List files error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred while listing files'
    }, { status: 500 });
  }
}