import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { SocialPost } from '@/types';
import { HttpError } from './http';
import { withMultipartUpload } from './multipart';
import { SOCIAL_POSTS_DIR, UUID_PATTERN } from './security-config';

const RECORD = '.post.json';
const METADATA_BYTES = 32 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']);
const shared = globalThis as typeof globalThis & { socialPostLocks?: Map<string, Promise<void>> };
const locks = shared.socialPostLocks ??= new Map();

function postDirectory(id: string) {
  if (!UUID_PATTERN.test(id)) throw new HttpError(404, 'Post not found');
  return path.join(SOCIAL_POSTS_DIR, id);
}

function serialized(post: SocialPost) {
  const data = JSON.stringify(post);
  if (Buffer.byteLength(data) > METADATA_BYTES) throw new HttpError(413, 'Post text is too large');
  return data;
}

async function withPostLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(id, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (locks.get(id) === current) locks.delete(id); }
}

export async function getSocialPost(id: string): Promise<SocialPost> {
  const directory = postDirectory(id);
  try {
    const post: SocialPost = JSON.parse(await fs.readFile(path.join(directory, RECORD), 'utf8'));
    return { ...post, archived: post.postedToTwitter && post.postedToLinkedIn };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Post not found');
    throw error;
  }
}

export async function listSocialPosts(): Promise<SocialPost[]> {
  await fs.mkdir(SOCIAL_POSTS_DIR, { recursive: true, mode: 0o700 });
  const posts: SocialPost[] = [];
  for (const entry of await fs.readdir(SOCIAL_POSTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
    try { posts.push(await getSocialPost(entry.name)); }
    catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  // Queue order: oldest drafts first. Updating a platform does not move a post.
  return posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function createSocialPost(request: Request): Promise<SocialPost> {
  if (!request.body) throw new HttpError(400, 'Post details are required');
  return withMultipartUpload(request.body, request.headers.get('content-type') || '', {
    fields: ['title', 'description'], fieldSize: 40_000, metadataBytes: METADATA_BYTES,
  }, async upload => {
    const title = upload.fields.title?.trim();
    const description = upload.fields.description?.trim();
    if (!title || title.length > 160) throw new HttpError(400, 'Title is required and must be at most 160 characters');
    if (!description || description.length > 10_000) throw new HttpError(400, 'Description is required and must be at most 10,000 characters');
    const id = randomUUID();
    const now = new Date().toISOString();
    const post: SocialPost = { id, title, description, createdAt: now, updatedAt: now,
      postedToTwitter: false, postedToLinkedIn: false, archived: false };
    if (upload.filename) {
      const handle = await fs.open(path.join(upload.directory, upload.filename), 'r');
      let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
      try {
        const buffer = Buffer.alloc(8192);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        detected = await fileTypeFromBuffer(buffer.subarray(0, bytesRead)).catch(() => undefined);
      } finally { await handle.close(); }
      if (!detected || !MEDIA_TYPES.has(detected.mime)) {
        throw new HttpError(400, 'Choose a JPEG, PNG, GIF, WebP image or an MP4, WebM, MOV video');
      }
      post.asset = { filename: upload.filename, size: upload.size, mimeType: detected.mime,
        kind: detected.mime.startsWith('image/') ? 'image' : 'video', url: `/api/social-posts/${id}/asset` };
    }
    await fs.writeFile(path.join(upload.directory, RECORD), serialized(post), { flag: 'wx', mode: 0o600 });
    await fs.mkdir(SOCIAL_POSTS_DIR, { recursive: true, mode: 0o700 });
    upload.signal.throwIfAborted();
    await fs.rename(upload.directory, postDirectory(id));
    return post;
  }, request.signal);
}

export async function updateSocialPost(id: string, changes: Record<string, unknown>): Promise<SocialPost> {
  const directory = postDirectory(id);
  const keys = Object.keys(changes);
  if (!keys.length || keys.some(key => !['postedToTwitter', 'postedToLinkedIn'].includes(key) || typeof changes[key] !== 'boolean')) {
    throw new HttpError(400, 'Posting status must be a boolean for Twitter or LinkedIn');
  }
  return withPostLock(id, async () => {
    const post = await getSocialPost(id);
    if (typeof changes.postedToTwitter === 'boolean') post.postedToTwitter = changes.postedToTwitter;
    if (typeof changes.postedToLinkedIn === 'boolean') post.postedToLinkedIn = changes.postedToLinkedIn;
    post.archived = post.postedToTwitter && post.postedToLinkedIn;
    post.updatedAt = new Date().toISOString();
    const temporary = path.join(directory, `${RECORD}.tmp`);
    try {
      await fs.writeFile(temporary, serialized(post), { mode: 0o600 });
      await fs.rename(temporary, path.join(directory, RECORD));
    } finally { await fs.rm(temporary, { force: true }); }
    return post;
  });
}

export async function deleteSocialPost(id: string) {
  const directory = postDirectory(id);
  return withPostLock(id, async () => {
    await getSocialPost(id);
    await fs.rm(directory, { recursive: true });
  });
}

export async function openSocialAsset(id: string) {
  const post = await getSocialPost(id);
  if (!post.asset) throw new HttpError(404, 'This post has no attachment');
  const handle = await fs.open(path.join(postDirectory(id), post.asset.filename), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
    if (error.code === 'ENOENT') throw new HttpError(404, 'Attachment not found');
    throw error;
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError(404, 'Attachment not found');
    return { handle, size: stat.size, asset: post.asset };
  } catch (error) { await handle.close(); throw error; }
}
