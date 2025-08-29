import { NextRequest, NextResponse } from 'next/server';
import { getFile } from '@/lib/storage';
import mime from 'mime-types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string; filename: string }> }
) {
  try {
    const { uuid, filename } = await params;
    
    // Decode the filename
    const decodedFilename = decodeURIComponent(filename);
    
    // Get file from storage
    const fileBuffer = await getFile(uuid, decodedFilename);
    
    if (!fileBuffer) {
      return new NextResponse('File not found', { status: 404 });
    }
    
    // Determine content type
    const contentType = mime.lookup(decodedFilename) || 'application/octet-stream';
    
    // Return file as response
    // Create a stream from the buffer
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(fileBuffer);
        controller.close();
      },
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${decodedFilename}"`,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}