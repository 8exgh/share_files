import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UploadedFile } from '@/types';
import { HttpError } from './http';
import { MAX_FILE_SIZE, MAX_NOTE_SIZE, UPLOAD_DIR, UPLOAD_TIMEOUT_MS, UUID_PATTERN } from './security-config';
import { reserveUpload } from './transfers';
import { withMultipartUpload } from './multipart';
import { sanitizeFilename, uploadFilename } from './filenames';
export { sanitizeFilename } from './filenames';

const AUTO_DELETE_MARKER = '.autodelete';
const TEMP_DIR = path.join(UPLOAD_DIR, '.pending');

export async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
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
  return withMultipartUpload(body, contentType, { fields: ['autoDelete'], fieldSize: 16 }, async upload => {
    const value = upload.fields.autoDelete;
    if (value !== undefined && !/^(true|false)$/i.test(value)) throw new HttpError(400, 'autoDelete must be true or false');
    if (!upload.filename) return null;
    const autoDelete = value === undefined ? defaultAutoDelete : value.toLowerCase() === 'true';
    return publish(upload.directory, upload.filename, upload.size, autoDelete);
  }, requestSignal);
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
