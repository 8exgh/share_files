import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { deleteFile, setAutoDelete } from '@/lib/storage';
import { ApiResponse } from '@/types';

interface RouteParams {
  params: Promise<{
    uuid: string;
  }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Unauthorized'
      }, { status: 401 });
    }

    const { uuid } = await params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Invalid file ID'
      }, { status: 400 });
    }

    const body = await request.json();
    const { autoDelete } = body;

    if (typeof autoDelete !== 'boolean') {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'autoDelete must be a boolean'
      }, { status: 400 });
    }

    const success = await setAutoDelete(uuid, autoDelete);

    if (!success) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'File not found or could not update'
      }, { status: 404 });
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      message: `Auto-delete ${autoDelete ? 'enabled' : 'disabled'}`
    });
  } catch (error) {
    console.error('Toggle auto-delete error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred'
    }, { status: 500 });
  }
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
