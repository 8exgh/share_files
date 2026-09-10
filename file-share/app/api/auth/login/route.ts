import { NextRequest, NextResponse } from 'next/server';
import { login } from '@/lib/auth';
import { ApiResponse } from '@/types';
import { errorResponse, readJsonBody } from '@/lib/http';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request, 8192);
    const { username, password } = body;

    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username || !password || username.length > 256 || password.length > 1024) {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Username and password are required'
      }, { status: 400 });
    }

    const success = await login(username, password);

    if (success) {
      return NextResponse.json<ApiResponse>({
        success: true,
        message: 'Login successful'
      });
    } else {
      return NextResponse.json<ApiResponse>({
        success: false,
        message: 'Invalid credentials'
      }, { status: 401 });
    }
  } catch (error) {
    return errorResponse(error, 'An error occurred during login');
  }
}
