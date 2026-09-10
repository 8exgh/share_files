import { HttpError } from './http';

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[\/\\]/g, '').replace(/\.{2,}/g, '.').replace(/[^\w\s.-]/g, '').trim();
}

export function uploadFilename(filename: string): string {
  const sanitized = sanitizeFilename(filename);
  if (!sanitized || sanitized.startsWith('.') || /[\x00-\x1f\x7f]/.test(sanitized) || Buffer.byteLength(sanitized) > 255) {
    throw new HttpError(400, 'Filename must be visible, non-empty, and at most 255 bytes');
  }
  return sanitized;
}
