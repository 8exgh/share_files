import { NextRequest, NextResponse } from 'next/server';
import { login } from '@/lib/auth';
import { ApiResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
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
    console.error('Login error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred during login'
    }, { status: 500 });
  }
}