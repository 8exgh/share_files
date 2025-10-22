import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { deleteFile } from '@/lib/storage';
import { ApiResponse } from '@/types';

interface RouteParams {
  params: Promise<{
    uuid: string;
  }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    // Check authentication
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    // Get UUID from params
    const { uuid } = await params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Invalid file ID'
      }, { status: 400 });
    }

    // Delete file
    const success = await deleteFile(uuid);

    if (!success) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'File not found or could not be deleted'
      }, { status: 404 });
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred while deleting the file'
    }, { status: 500 });
  }
}
