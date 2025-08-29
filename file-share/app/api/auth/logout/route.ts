import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth';
import { ApiResponse } from '@/types';

export async function POST() {
  try {
    await logout();
    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      message: 'An error occurred during logout'
    }, { status: 500 });
  }
}