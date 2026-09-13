import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { AnonymousFile } from '@/types';
import { ANONYMOUS_DIR, ANONYMOUS_TTL_MS, MAX_NOTE_SIZE, UPLOAD_DIR, UUID_PATTERN } from './security-config';
import { HttpError, readJsonBody } from './http';
import { withMultipartUpload } from './multipart';
import { reserveUpload } from './transfers';
import { sanitizeFilename, uploadFilename } from './filenames';

const RECORD = '.file.json';
const METADATA_BYTES = 4096;

export function maskIp(value: string): string {
  const version = isIP(value);
  if (version === 4) return value.split('.').slice(-2).join('.');
  if (version !== 6) return 'Unknown';
  let address = value.split('%')[0];
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const bytes = address.slice(lastColon + 1).split('.').map(Number);
    address = `${address.slice(0, lastColon + 1)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const [left, right] = address.split('::');
  const start = left ? left.split(':') : [];
  const end = right ? right.split(':') : [];
  const groups: number[] = (right === undefined ? start : [...start, ...Array(Math.max(0, 8 - start.length - end.length)).fill('0'), ...end]).map(group => parseInt(group, 16));
  // IPv4-mapped IPv6 addresses keep the same display as IPv4.
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) return `${groups[7] >> 8}.${groups[7] & 255}`;
  return groups.slice(-2).map(group => group.toString(16)).join(':');
}

function identity(headers: Headers) {
  const cloudflareIp = headers.get('cf-connecting-ip')?.trim() || '';
  const peerIp = headers.get('x-file-share-peer-ip')?.trim() || '';
  const country = headers.get('cf-ipcountry')?.trim().toUpperCase() || '';
  return {
    maskedIp: maskIp(isIP(cloudflareIp) ? cloudflareIp : peerIp),
    countryCode: /^(?:[A-Z]{2}|T1)$/.test(country) && country !== 'XX' ? country : null,
  };
}

function directory(id: string) {
  if (!UUID_PATTERN.test(id)) throw new HttpError(404, 'File not found or expired');
  return path.join(ANONYMOUS_DIR, id);
}

async function publish(temporary: string, filename: string, size: number, sha256: string, kind: AnonymousFile['kind'], headers: Headers, signal: AbortSignal): Promise<AnonymousFile> {
  const id = randomUUID();
  const now = Date.now();
  const downloadUrl = `/a/${id}/${encodeURIComponent(filename)}`;
  const file: AnonymousFile = {
    id, filename, size, kind, sha256, downloadUrl,
    uploadDate: new Date(now).toISOString(), expiresAt: new Date(now + ANONYMOUS_TTL_MS).toISOString(),
    ...identity(headers), ...(kind === 'note' ? { viewUrl: `${downloadUrl}?view=1` } : {}),
  };
  const record = JSON.stringify(file);
  if (Buffer.byteLength(record) > METADATA_BYTES) throw new HttpError(413, 'File details are too large');
  await fs.writeFile(path.join(temporary, RECORD), record, { flag: 'wx', mode: 0o600 });
  await fs.mkdir(ANONYMOUS_DIR, { recursive: true, mode: 0o700 });
  signal.throwIfAborted();
  await fs.rename(temporary, directory(id));
  return file;
}

export async function saveAnonymousFile(request: Request): Promise<AnonymousFile> {
  if (!request.body) throw new HttpError(400, 'A file is required');
  // No fields are accepted: callers cannot select retention or pin a public upload.
  return withMultipartUpload(request.body, request.headers.get('content-type') || '', {
    fields: [], fieldSize: 0, metadataBytes: METADATA_BYTES, anonymous: true, sha256: true,
  }, async upload => {
    if (!upload.filename) throw new HttpError(400, 'A file is required');
    return publish(upload.directory, upload.filename, upload.size, upload.sha256!, 'file', request.headers, upload.signal);
  }, request.signal);
}

export async function saveAnonymousNote(request: Request): Promise<AnonymousFile> {
  // Reserve a transfer slot before reading a public JSON body, just like file uploads.
  const release = await reserveUpload(MAX_NOTE_SIZE + METADATA_BYTES, true);
  let temporary: string | undefined;
  try {
    const data = await readJsonBody(request, MAX_NOTE_SIZE * 6 + 4096);
    if (Object.keys(data).some(key => !['name', 'content'].includes(key))) throw new HttpError(400, 'Only a note name and content are accepted');
    if (typeof data.content !== 'string' || !data.content.trim()) throw new HttpError(400, 'Note content cannot be empty');
    if (data.name !== undefined && typeof data.name !== 'string') throw new HttpError(400, 'Note name must be text');
    const buffer = Buffer.from(data.content, 'utf8');
    if (buffer.length > MAX_NOTE_SIZE) throw new HttpError(413, 'Note exceeds the configured size limit');
    let filename = typeof data.name === 'string' && data.name.trim() ? uploadFilename(data.name) : `Note_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (!filename.toLowerCase().endsWith('.txt')) filename += '.txt';
    filename = uploadFilename(filename);
    const pending = path.join(UPLOAD_DIR, '.pending');
    await fs.mkdir(pending, { recursive: true, mode: 0o700 });
    temporary = await fs.mkdtemp(path.join(pending, 'upload-'));
    await fs.writeFile(path.join(temporary, filename), buffer, { flag: 'wx', mode: 0o600 });
    return await publish(temporary, filename, buffer.length, createHash('sha256').update(buffer).digest('hex'), 'note', request.headers, request.signal);
  } finally {
    try { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
    finally { release(); }
  }
}

async function readRecord(id: string): Promise<AnonymousFile> {
  try { return JSON.parse(await fs.readFile(path.join(directory(id), RECORD), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'File not found or expired');
    throw error;
  }
}

function expired(file: AnonymousFile) {
  const expiry = Math.min(Date.parse(file.expiresAt), Date.parse(file.uploadDate) + ANONYMOUS_TTL_MS);
  return !Number.isFinite(expiry) || Date.now() >= expiry;
}

async function entries() {
  await fs.mkdir(ANONYMOUS_DIR, { recursive: true, mode: 0o700 });
  return (await fs.readdir(ANONYMOUS_DIR, { withFileTypes: true })).filter(entry => entry.isDirectory() && UUID_PATTERN.test(entry.name));
}

export async function cleanupAnonymousFiles(): Promise<string[]> {
  const deleted: string[] = [];
  for (const entry of await entries()) {
    try {
      if (expired(await readRecord(entry.name))) {
        await fs.rm(directory(entry.name), { recursive: true, force: true });
        deleted.push(entry.name);
      }
    } catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  return deleted;
}

export async function getAnonymousFile(id: string): Promise<AnonymousFile> {
  const file = await readRecord(id);
  if (expired(file)) {
    await fs.rm(directory(id), { recursive: true, force: true });
    throw new HttpError(404, 'File not found or expired');
  }
  return file;
}

export async function listAnonymousFiles(): Promise<AnonymousFile[]> {
  const files: AnonymousFile[] = [];
  for (const entry of await entries()) {
    try { files.push(await getAnonymousFile(entry.name)); }
    catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  return files.sort((a, b) => b.uploadDate.localeCompare(a.uploadDate) || a.id.localeCompare(b.id));
}

export async function openAnonymousFile(id: string, filename: string) {
  const file = await getAnonymousFile(id);
  if (filename !== file.filename || filename !== sanitizeFilename(filename) || filename.startsWith('.')) throw new HttpError(404, 'File not found');
  const handle = await fs.open(path.join(directory(id), filename), constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw new HttpError(404, 'File not found');
    throw error;
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new HttpError(404, 'File not found');
    return { handle, size: stat.size, file };
  } catch (error) { await handle.close(); throw error; }
}
