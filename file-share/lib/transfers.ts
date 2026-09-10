import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_CONCURRENT_DOWNLOADS, MAX_CONCURRENT_UPLOADS, MAX_STORAGE_SIZE, UPLOAD_DIR, SOCIAL_POSTS_DIR, UUID_PATTERN } from './security-config';
import { HttpError } from './http';

const shared = globalThis as typeof globalThis & { fileShareTransfers?: {
  downloads: number; uploads: number; reservedBytes: number; queue: Promise<void>;
} };
const state = shared.fileShareTransfers ??= { downloads: 0, uploads: 0, reservedBytes: 0, queue: Promise.resolve() };

export function reserveDownload(): () => void {
  if (state.downloads >= MAX_CONCURRENT_DOWNLOADS) {
    throw new HttpError(503, 'Too many active downloads. Try again shortly.', { 'Retry-After': '1' });
  }
  state.downloads++;
  let released = false;
  return () => { if (!released) { released = true; state.downloads--; } };
}

export async function reserveUpload(maxBytes: number): Promise<() => void> {
  if (state.uploads >= MAX_CONCURRENT_UPLOADS) {
    throw new HttpError(503, 'Too many active uploads. Try again shortly.', { 'Retry-After': '1' });
  }
  state.uploads++;
  const previous = state.queue;
  let unlock!: () => void;
  state.queue = new Promise<void>(resolve => { unlock = resolve; });
  await previous;
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    let usedBytes = 0;
    await fs.mkdir(SOCIAL_POSTS_DIR, { recursive: true, mode: 0o700 });
    for (const root of [UPLOAD_DIR, SOCIAL_POSTS_DIR]) {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
        const directory = path.join(root, entry.name);
        try {
          for (const name of await fs.readdir(directory)) {
            const stat = await fs.lstat(path.join(directory, name));
            if (stat.isFile()) usedBytes += stat.size;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    if (usedBytes + state.reservedBytes + maxBytes > MAX_STORAGE_SIZE) {
      throw new HttpError(507, 'Storage quota exceeded. Delete files before uploading.');
    }
    state.reservedBytes += maxBytes;
  } catch (error) {
    state.uploads--;
    throw error;
  } finally {
    unlock();
  }
  let released = false;
  return () => {
    if (!released) { released = true; state.uploads--; state.reservedBytes -= maxBytes; }
  };
}
