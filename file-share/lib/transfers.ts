import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_CONCURRENT_DOWNLOADS, MAX_CONCURRENT_UPLOADS, MAX_CONCURRENT_ANONYMOUS_UPLOADS, MAX_STORAGE_SIZE, MAX_ANONYMOUS_STORAGE_SIZE, MAX_ANONYMOUS_FILES, UPLOAD_DIR, SOCIAL_POSTS_DIR, ANONYMOUS_DIR, UUID_PATTERN } from './security-config';
import { HttpError } from './http';

const shared = globalThis as typeof globalThis & { fileShareTransfers?: {
  downloads: number; uploads: number; reservedBytes: number; anonymousReservedBytes: number; anonymousUploads: number; queue: Promise<void>;
} };
const state = shared.fileShareTransfers ??= { downloads: 0, uploads: 0, reservedBytes: 0, anonymousReservedBytes: 0, anonymousUploads: 0, queue: Promise.resolve() };
state.anonymousReservedBytes ??= 0;
state.anonymousUploads ??= 0;

export function reserveDownload(): () => void {
  if (state.downloads >= MAX_CONCURRENT_DOWNLOADS) {
    throw new HttpError(503, 'Too many active downloads. Try again shortly.', { 'Retry-After': '1' });
  }
  state.downloads++;
  let released = false;
  return () => { if (!released) { released = true; state.downloads--; } };
}

export async function reserveUpload(maxBytes: number, anonymous = false): Promise<() => void> {
  if (state.uploads >= MAX_CONCURRENT_UPLOADS || (anonymous && state.anonymousUploads >= MAX_CONCURRENT_ANONYMOUS_UPLOADS)) {
    throw new HttpError(503, 'Too many active uploads. Try again shortly.', { 'Retry-After': '1' });
  }
  state.uploads++;
  if (anonymous) state.anonymousUploads++;
  const previous = state.queue;
  let unlock!: () => void;
  state.queue = new Promise<void>(resolve => { unlock = resolve; });
  await previous;
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    let usedBytes = 0;
    let anonymousBytes = 0;
    let anonymousFiles = 0;
    await fs.mkdir(SOCIAL_POSTS_DIR, { recursive: true, mode: 0o700 });
    await fs.mkdir(ANONYMOUS_DIR, { recursive: true, mode: 0o700 });
    for (const root of [UPLOAD_DIR, SOCIAL_POSTS_DIR, ANONYMOUS_DIR]) {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
        if (root === ANONYMOUS_DIR) anonymousFiles++;
        const directory = path.join(root, entry.name);
        try {
          for (const name of await fs.readdir(directory)) {
            const stat = await fs.lstat(path.join(directory, name));
            if (stat.isFile()) {
              usedBytes += stat.size;
              if (root === ANONYMOUS_DIR) anonymousBytes += stat.size;
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    if (anonymous && anonymousBytes + state.anonymousReservedBytes + maxBytes > MAX_ANONYMOUS_STORAGE_SIZE) {
      throw new HttpError(507, 'Anonymous storage is full. Please try again after files expire.');
    }
    if (anonymous && anonymousFiles + state.anonymousUploads > MAX_ANONYMOUS_FILES) {
      throw new HttpError(507, 'The anonymous file list is full. Please try again after entries expire.');
    }
    if (usedBytes + state.reservedBytes + maxBytes > MAX_STORAGE_SIZE) {
      throw new HttpError(507, 'Storage quota exceeded. Delete files before uploading.');
    }
    state.reservedBytes += maxBytes;
    if (anonymous) state.anonymousReservedBytes += maxBytes;
  } catch (error) {
    state.uploads--;
    if (anonymous) state.anonymousUploads--;
    throw error;
  } finally {
    unlock();
  }
  let released = false;
  return () => {
    if (!released) {
      released = true; state.uploads--; state.reservedBytes -= maxBytes;
      if (anonymous) { state.anonymousReservedBytes -= maxBytes; state.anonymousUploads--; }
    }
  };
}
