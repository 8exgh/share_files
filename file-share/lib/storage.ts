import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { UploadedFile } from '@/types';
import { HttpError } from './http';
import { MAX_FILE_SIZE, MAX_NOTE_SIZE, UPLOAD_DIR, UPLOAD_TIMEOUT_MS, UUID_PATTERN } from './security-config';
import { reserveUpload } from './transfers';

const AUTO_DELETE_MARKER = '.autodelete';
const TEMP_DIR = path.join(UPLOAD_DIR, '.pending');

export async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[\/\\]/g, '').replace(/\.{2,}/g, '.').replace(/[^\w\s.-]/g, '').trim();
}

function uploadFilename(filename: string): string {
  const sanitized = sanitizeFilename(filename);
  if (!sanitized || sanitized.startsWith('.') || /[\x00-\x1f\x7f]/.test(sanitized) || Buffer.byteLength(sanitized) > 255) {
    throw new HttpError(400, 'Filename must be visible, non-empty, and at most 255 bytes');
  }
  return sanitized;
}

async function pendingDirectory() {
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
  return fs.mkdtemp(path.join(TEMP_DIR, 'upload-'));
}

async function publish(directory: string, filename: string, size: number, autoDelete: boolean): Promise<UploadedFile> {
  const id = randomUUID();
  if (autoDelete) await fs.writeFile(path.join(directory, AUTO_DELETE_MARKER), '', { mode: 0o600 });
  await fs.rename(directory, path.join(UPLOAD_DIR, id));
  return { id, filename, size, uploadDate: new Date().toISOString(),
    downloadUrl: `/f/${id}/${encodeURIComponent(filename)}`, autoDelete };
}

export async function saveFile(buffer: Buffer, originalFilename: string): Promise<UploadedFile> {
  const filename = uploadFilename(originalFilename);
  if (buffer.length > MAX_FILE_SIZE) throw new HttpError(413, 'File exceeds the configured size limit');
  const release = await reserveUpload(buffer.length);
  let directory: string | undefined;
  try {
    directory = await pendingDirectory();
    await fs.writeFile(path.join(directory, filename), buffer, { flag: 'wx', mode: 0o600 });
    return await publish(directory, filename, buffer.length, true);
  } finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}

export async function saveFileStream(
  body: ReadableStream<Uint8Array>, contentType: string, defaultAutoDelete = true, requestSignal?: AbortSignal,
): Promise<UploadedFile | null> {
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({ headers: { 'content-type': contentType }, limits: {
      fileSize: MAX_FILE_SIZE + 1, files: 1, fields: 1, parts: 3,
      fieldSize: 16, fieldNameSize: 32, headerPairs: 20,
    } });
  } catch { throw new HttpError(400, 'Invalid multipart boundary'); }
  const release = await reserveUpload(MAX_FILE_SIZE);
  let directory: string | undefined;
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, ...(requestSignal ? [requestSignal] : [])]);
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= error;
    // Let Busboy finish its current callback before destroying its streams.
    queueMicrotask(() => abort.abort(error));
  };
  const timeout = setTimeout(() => fail(new HttpError(408, 'Upload timed out')), UPLOAD_TIMEOUT_MS);
  const writes: Promise<void>[] = [];
  try {
    directory = await pendingDirectory();
    let filename: string | undefined;
    let size = 0;
    let autoDelete = defaultAutoDelete;
    parser.on('file', (field, file, info) => {
      file.on('error', fail);
      try {
        if (field !== 'file') throw new HttpError(400, 'Multipart file field must be named file');
        filename = uploadFilename(info.filename);
        file.on('limit', () => fail(new HttpError(413, 'File exceeds the configured size limit')));
        const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          callback(size > MAX_FILE_SIZE ? new HttpError(413, 'File exceeds the configured size limit') : null, chunk);
        } });
        writes.push(pipeline(file, counter, createWriteStream(path.join(directory!, filename), {
          flags: 'wx', mode: 0o600,
        }), { signal }).catch(fail));
      } catch (error) {
        file.resume();
        fail(error as Error);
      }
    });
    parser.on('field', (field, value, info) => {
      if (field !== 'autoDelete' || info.nameTruncated || info.valueTruncated || !/^(true|false)$/i.test(value)) {
        fail(new HttpError(400, 'autoDelete must be true or false'));
      } else autoDelete = value.toLowerCase() === 'true';
    });
    parser.on('filesLimit', () => fail(new HttpError(400, 'Only one file is allowed')));
    parser.on('fieldsLimit', () => fail(new HttpError(400, 'Too many multipart fields')));
    parser.on('partsLimit', () => fail(new HttpError(400, 'Too many multipart parts')));
    let bodySize = 0;
    const bodyLimit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bodySize += chunk.length;
      callback(bodySize > MAX_FILE_SIZE + 64 * 1024 ? new HttpError(413, 'Request body is too large') : null, chunk);
    } });
    try {
      await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), bodyLimit, parser, { signal });
    } catch (error) { fail(error as Error); }
    await Promise.all(writes);
    if (failure) throw failure;
    signal.throwIfAborted();
    if (!filename) return null;
    return await publish(directory, filename, size, autoDelete);
  } catch (error) {
    abort.abort();
    await Promise.all(writes);
    if (error instanceof HttpError) throw error;
    if (requestSignal?.aborted) throw new HttpError(400, 'Upload was interrupted');
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw new HttpError(507, 'Insufficient storage');
    if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code === 'ABORT_ERR') {
      throw new HttpError(400, 'Invalid or incomplete multipart upload');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}

export async function saveNote(content: string, name?: string): Promise<UploadedFile> {
  if (Buffer.byteLength(content) > MAX_NOTE_SIZE) throw new HttpError(413, 'Note exceeds the configured size limit');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const defaultName = `Note_${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}___${pad(now.getHours())}_${pad(now.getMinutes())}_${pad(now.getSeconds())}`;
  let filename = name?.trim() ? uploadFilename(name.trim()) : defaultName;
  if (!filename.toLowerCase().endsWith('.txt')) filename += '.txt';
  return saveFile(Buffer.from(content, 'utf8'), filename);
}

export async function listFiles(): Promise<UploadedFile[]> {
  await ensureUploadDir();
  const files: UploadedFile[] = [];
  for (const entry of await fs.readdir(UPLOAD_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
    const directory = path.join(UPLOAD_DIR, entry.name);
    try {
      const entries = await fs.readdir(directory);
      const filename = entries.find(name => !name.startsWith('.'));
      if (!filename) continue;
      const stat = await fs.lstat(path.join(directory, filename));
      if (!stat.isFile()) continue;
      files.push({ id: entry.name, filename, size: stat.size, uploadDate: stat.birthtime.toISOString(),
        downloadUrl: `/f/${entry.name}/${encodeURIComponent(filename)}`, autoDelete: entries.includes(AUTO_DELETE_MARKER) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return files.sort((a, b) => Date.parse(b.uploadDate) - Date.parse(a.uploadDate));
}

export async function openFile(uuid: string, filename: string) {
  if (!UUID_PATTERN.test(uuid) || filename !== sanitizeFilename(filename) || !filename || filename.startsWith('.') || /[\x00-\x1f\x7f]/.test(filename)) return null;
  try {
    const handle = await fs.open(path.join(UPLOAD_DIR, uuid, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) { await handle.close(); return null; }
      return { handle, size: stat.size, filename };
    } catch (error) { await handle.close(); throw error; }
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code || '')) return null;
    throw error;
  }
}

export async function setAutoDelete(uuid: string, autoDelete: boolean): Promise<boolean> {
  if (!UUID_PATTERN.test(uuid)) return false;
  const directory = path.join(UPLOAD_DIR, uuid);
  try {
    if (!(await fs.lstat(directory)).isDirectory()) return false;
    if (autoDelete) await fs.writeFile(path.join(directory, AUTO_DELETE_MARKER), '', { mode: 0o600 });
    else await fs.rm(path.join(directory, AUTO_DELETE_MARKER), { force: true });
    return true;
  } catch { return false; }
}

export async function cleanupExpiredFiles(maxAgeMs = 60 * 60 * 1000): Promise<string[]> {
  await ensureUploadDir();
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
  // Active uploads have a deadline. Older directories belong to interrupted processes.
  for (const entry of await fs.readdir(TEMP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('upload-')) continue;
    const directory = path.join(TEMP_DIR, entry.name);
    try {
      if (Date.now() - (await fs.stat(directory)).mtimeMs > UPLOAD_TIMEOUT_MS + 60_000) {
        await fs.rm(directory, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const deleted: string[] = [];
  for (const file of await listFiles()) {
    if (file.autoDelete && Date.now() - Date.parse(file.uploadDate) > maxAgeMs && await deleteFile(file.id)) deleted.push(file.id);
  }
  return deleted;
}

export async function deleteFile(uuid: string): Promise<boolean> {
  if (!UUID_PATTERN.test(uuid)) return false;
  try { await fs.rm(path.join(UPLOAD_DIR, uuid), { recursive: true, force: true }); return true; }
  catch { return false; }
}
