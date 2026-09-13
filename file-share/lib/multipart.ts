import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { HttpError } from './http';
import { MAX_FILE_SIZE, UPLOAD_DIR, UPLOAD_TIMEOUT_MS } from './security-config';
import { reserveUpload } from './transfers';
import { uploadFilename } from './filenames';

const TEMP_DIR = path.join(UPLOAD_DIR, '.pending');
export interface MultipartUpload {
  directory: string;
  filename?: string;
  size: number;
  fields: Record<string, string>;
  signal: AbortSignal;
  sha256?: string;
}

// The caller publishes by renaming the temporary directory. Every other path cleans it up.
export async function withMultipartUpload<T>(
  body: ReadableStream<Uint8Array>, contentType: string,
  options: { fields: string[]; fieldSize: number; metadataBytes?: number; anonymous?: boolean; sha256?: boolean },
  complete: (upload: MultipartUpload) => Promise<T>, requestSignal?: AbortSignal,
): Promise<T> {
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({ headers: { 'content-type': contentType }, limits: {
      fileSize: MAX_FILE_SIZE + 1, files: 1, fields: options.fields.length, parts: options.fields.length + 2,
      fieldSize: options.fieldSize, fieldNameSize: 32, headerPairs: 20,
    } });
  } catch { throw new HttpError(400, 'Invalid multipart boundary'); }
  const release = await reserveUpload(MAX_FILE_SIZE + (options.metadataBytes || 0), options.anonymous);
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
    await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
    directory = await fs.mkdtemp(path.join(TEMP_DIR, 'upload-'));
    let filename: string | undefined;
    let size = 0;
    const hash = options.sha256 ? createHash('sha256') : undefined;
    const fields: Record<string, string> = Object.create(null);
    parser.on('file', (field, file, info) => {
      file.on('error', fail);
      try {
        if (field !== 'file') throw new HttpError(400, 'Multipart file field must be named file');
        filename = uploadFilename(info.filename);
        file.on('limit', () => fail(new HttpError(413, 'File exceeds the configured size limit')));
        const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size <= MAX_FILE_SIZE) hash?.update(chunk);
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
      if (!options.fields.includes(field) || field in fields || info.nameTruncated || info.valueTruncated) {
        fail(new HttpError(400, 'Invalid, duplicate, or oversized multipart field'));
      } else fields[field] = value;
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
    return await complete({ directory, filename, size, fields, signal, sha256: hash?.digest('hex') });
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
