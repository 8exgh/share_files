import path from 'node:path';

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
export const SECURITY_DIR = path.join(UPLOAD_DIR, '.security');
export const SOCIAL_POSTS_DIR = path.join(UPLOAD_DIR, '.social-posts');
export const MAX_FILE_SIZE = positiveInteger('MAX_FILE_SIZE', 100 * 1024 * 1024);
export const MAX_NOTE_SIZE = Math.min(MAX_FILE_SIZE, positiveInteger('MAX_NOTE_SIZE', 1024 * 1024));
export const MAX_STORAGE_SIZE = positiveInteger('MAX_STORAGE_SIZE', 10 * 1024 * 1024 * 1024);
export const MAX_CONCURRENT_UPLOADS = positiveInteger('MAX_CONCURRENT_UPLOADS', 4);
export const MAX_CONCURRENT_DOWNLOADS = positiveInteger('MAX_CONCURRENT_DOWNLOADS', 32);
export const AUTH_MAX_ATTEMPTS = positiveInteger('AUTH_MAX_ATTEMPTS', 10);
export const AUTH_WINDOW_MS = positiveInteger('AUTH_WINDOW_MS', 15 * 60 * 1000);
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const UPLOAD_TIMEOUT_MS = positiveInteger('UPLOAD_TIMEOUT_MS', 10 * 60 * 1000);
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
