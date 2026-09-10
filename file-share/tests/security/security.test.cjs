const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

// Compile the actual server modules into a disposable fixture, without touching app data.
const app = path.resolve(__dirname, '../..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'file-share-security-test-'));
const compiled = path.join(fixture, 'compiled');
fs.mkdirSync(compiled);
fs.symlinkSync(path.join(app, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
for (const name of fs.readdirSync(path.join(app, 'lib')).filter(n => n.endsWith('.ts'))) {
  const output = ts.transpileModule(fs.readFileSync(path.join(app, 'lib', name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  fs.writeFileSync(path.join(compiled, name.replace(/\.ts$/, '.js')), output);
}
Object.assign(process.env, {
  UPLOAD_DIR: path.join(fixture, 'uploads'), MAX_FILE_SIZE: '1024', MAX_NOTE_SIZE: '512',
  MAX_STORAGE_SIZE: '4096', MAX_CONCURRENT_UPLOADS: '2', MAX_CONCURRENT_DOWNLOADS: '2',
  AUTH_MAX_ATTEMPTS: '3', AUTH_WINDOW_MS: '1000', UPLOAD_TIMEOUT_MS: '1000',
  SESSION_SECRET: 'security-test-secret-with-more-than-32-characters',
  ADMIN_USERNAME: 'test-admin', ADMIN_PASSWORD: 'test-password',
});
const storage = require(path.join(compiled, 'storage.js'));
const auth = require(path.join(compiled, 'auth-state.js'));
const { readJsonBody } = require(path.join(compiled, 'http.js'));
const { reserveDownload, reserveUpload } = require(path.join(compiled, 'transfers.js'));
const { downloadStream } = require(path.join(compiled, 'download.js'));
const uploadDir = process.env.UPLOAD_DIR;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fails = status => error => error.status === status;
const contentType = 'multipart/form-data; boundary="security-boundary"';
function multipart(filename, content, fields = '') {
  return Buffer.concat([Buffer.from(`--security-boundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(content), Buffer.from(`\r\n${fields}--security-boundary--\r\n`)]);
}
function webBody(bytes, chunkSize = 73) {
  let position = 0;
  return new ReadableStream({ pull(controller) {
    if (position >= bytes.length) controller.close();
    else { controller.enqueue(bytes.subarray(position, position += chunkSize)); }
  } });
}
async function assertNoUploads() {
  assert.deepEqual(await storage.listFiles(), []);
  const entries = await fsp.readdir(path.join(uploadDir, '.pending')).catch(() => []);
  assert.deepEqual(entries, []);
}
beforeEach(async () => {
  await fsp.rm(uploadDir, { recursive: true, force: true });
  await fsp.mkdir(uploadDir, { recursive: true });
});
after(async () => { await fsp.rm(fixture, { recursive: true, force: true }); });

test('streaming accepts the exact file limit and honors fields after the file', async () => {
  const fields = '--security-boundary\r\nContent-Disposition: form-data; name="autoDelete"\r\n\r\nfalse\r\n';
  const file = await storage.saveFileStream(webBody(multipart('boundary.bin', Buffer.alloc(1024, 65), fields)), contentType);
  assert.equal(file.size, 1024);
  assert.equal(file.autoDelete, false);
  assert.equal((await storage.listFiles())[0].autoDelete, false);
  assert.equal((await fsp.readFile(path.join(uploadDir, file.id, file.filename))).length, 1024);
});

test('oversized chunked uploads are rejected without leaving files', async () => {
  await assert.rejects(storage.saveFileStream(webBody(multipart('oversized.bin', Buffer.alloc(1025))), contentType), fails(413));
  await assertNoUploads();
});

test('malformed multipart and reserved filenames cannot publish files or crash', async () => {
  await assert.rejects(storage.saveFileStream(webBody(Buffer.from('--security-boundary\r\nContent-Disposition: form-data; name="file"; filename="broken.txt"\r\n\r\npartial')), contentType), fails(400));
  for (const filename of ['.autodelete', '.hidden.txt', '!!!']) {
    await assert.rejects(storage.saveFileStream(webBody(multipart(filename, 'data')), contentType), fails(400));
  }
  await assertNoUploads();
});

test('extra files and fields are rejected with complete cleanup', async () => {
  const secondFile = '--security-boundary\r\nContent-Disposition: form-data; name="file"; filename="second.txt"\r\n\r\nsecond\r\n';
  await assert.rejects(storage.saveFileStream(webBody(multipart('first.txt', 'first', secondFile)), contentType), fails(400));
  await assert.rejects(storage.saveFileStream(webBody(multipart('first.txt', 'first', '--security-boundary\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\nvalue\r\n')), contentType), fails(400));
  await assertNoUploads();
});

test('disconnects discard partially written uploads', async () => {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  const result = storage.saveFileStream(body, contentType).then(() => null, error => error);
  controller.enqueue(Buffer.from('--security-boundary\r\nContent-Disposition: form-data; name="file"; filename="interrupted.txt"\r\n\r\npartial'));
  await delay(20);
  controller.error(new Error('simulated disconnect'));
  assert.equal((await result).status, 400);
  await assertNoUploads();
});

test('upload deadlines cancel stalled requests and reclaim abandoned directories', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(storage.saveFileStream(body, contentType), fails(408));
  assert.equal(cancelled, true);
  await assertNoUploads();
  const abandoned = path.join(uploadDir, '.pending', 'upload-abandoned');
  await fsp.mkdir(abandoned);
  await fsp.writeFile(path.join(abandoned, 'partial'), 'left behind');
  await fsp.utimes(abandoned, new Date(0), new Date(0));
  await storage.cleanupExpiredFiles();
  assert.equal(fs.existsSync(abandoned), false);
});

test('write errors leave no published or pending upload', async () => {
  const original = fs.createWriteStream;
  const { Writable } = require('node:stream');
  fs.createWriteStream = () => new Writable({ write(_chunk, _encoding, callback) {
    callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
  } });
  try { await assert.rejects(storage.saveFileStream(webBody(multipart('full.txt', 'data')), contentType), fails(507)); }
  finally { fs.createWriteStream = original; }
  await assertNoUploads();
});

test('notes enforce UTF-8 byte limits and hidden metadata stays out of the file list', async () => {
  await assert.rejects(storage.saveNote('é'.repeat(257)), fails(413));
  await storage.saveNote('é'.repeat(256), 'utf8');
  await auth.createSessionRecord();
  assert.equal((await storage.listFiles()).length, 1);
});

test('storage quota includes existing files and active upload reservations', async () => {
  for (let i = 0; i < 4; i++) await storage.saveFile(Buffer.alloc(1024), `${i}.bin`);
  await assert.rejects(storage.saveFile(Buffer.from('x'), 'excess.txt'), fails(507));
  await fsp.rm(uploadDir, { recursive: true, force: true });
  const first = await reserveUpload(3072);
  try { await assert.rejects(reserveUpload(2048), fails(507)); } finally { first(); }
  const a = await reserveUpload(1), b = await reserveUpload(1);
  try { await assert.rejects(reserveUpload(1), fails(503)); } finally { a(); b(); }
  const restored = await reserveUpload(4096); restored();
});

test('downloads apply backpressure, bound chunks, and close on EOF and cancel', async () => {
  const small = await storage.saveFile(Buffer.from('complete'), 'small.txt');
  const file = await storage.saveFile(Buffer.alloc(1024, 65), 'download.bin');
  // Grow a test fixture directly to exercise existing large files without uploading them.
  await fsp.truncate(path.join(uploadDir, file.id, file.filename), 8 * 1024 * 1024);
  const opened = await storage.openFile(file.id, file.filename);
  let reads = 0, released = 0;
  const originalRead = opened.handle.read.bind(opened.handle);
  opened.handle.read = (...args) => { reads++; return originalRead(...args); };
  const stream = downloadStream(opened.handle, new AbortController().signal, () => released++);
  await delay(20);
  assert.ok(reads <= 1, `unconsumed stream eagerly read ${reads} chunks`);
  const reader = stream.getReader();
  assert.equal((await reader.read()).value.length, 64 * 1024);
  await reader.cancel();
  assert.equal(released, 1);
  assert.equal(opened.handle.fd, -1);
  const handle = await storage.openFile(small.id, small.filename);
  assert.equal(await new Response(downloadStream(handle.handle, new AbortController().signal, () => {})).text(), 'complete');
  assert.equal(handle.handle.fd, -1);
});

test('download aborts and read failures close descriptors and release admission slots', async () => {
  const file = await storage.saveFile(Buffer.from('abort'), 'abort.txt');
  const opened = await storage.openFile(file.id, file.filename);
  const abort = new AbortController();
  let releases = 0;
  const reader = downloadStream(opened.handle, abort.signal, () => releases++).getReader();
  abort.abort();
  await assert.rejects(reader.read());
  await delay(20);
  assert.equal(releases, 1);
  assert.equal(opened.handle.fd, -1);
  const failed = await storage.openFile(file.id, file.filename);
  failed.handle.read = async () => { throw new Error('simulated read error'); };
  await assert.rejects(new Response(downloadStream(failed.handle, new AbortController().signal, () => releases++)).text());
  await delay(20);
  assert.equal(releases, 2);
  assert.equal(failed.handle.fd, -1);
  const a = reserveDownload(), b = reserveDownload();
  try { assert.throws(reserveDownload, fails(503)); } finally { a(); b(); }
  const c = reserveDownload(); c();
});

test('public paths cannot read private state or escape the upload directory', async () => {
  assert.equal(await storage.openFile('..', 'package.json'), null);
  assert.equal(await storage.openFile('00000000-0000-4000-8000-000000000001', '.autodelete'), null);
  assert.equal(await storage.openFile('00000000-0000-4000-8000-000000000001', '../package.json'), null);
});

test('bounded JSON parsing covers chunked, malformed, and non-object bodies', async () => {
  const request = (text) => new Request('http://localhost/api/test', { method: 'POST', body: webBody(Buffer.from(text)), duplex: 'half' });
  await assert.rejects(readJsonBody(request('{"value":"' + 'a'.repeat(100) + '"}'), 32), fails(413));
  await assert.rejects(readJsonBody(request('['), 32), fails(400));
  await assert.rejects(readJsonBody(request('null'), 32), fails(400));
  assert.deepEqual(await readJsonBody(request('{"ok":true}'), 32), { ok: true });
});

test('sessions are revocable, expire, and are invalidated by password changes', async () => {
  const id = await auth.createSessionRecord();
  assert.equal(await auth.sessionIsValid(id), true);
  await auth.revokeSession(id);
  assert.equal(await auth.sessionIsValid(id), false);
  assert.equal(await auth.sessionIsValid(undefined), false);
  const changed = await auth.createSessionRecord();
  const password = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 'rotated-password';
  assert.equal(await auth.sessionIsValid(changed), false);
  process.env.ADMIN_PASSWORD = password;
  const recordPath = path.join(uploadDir, '.security/sessions', changed);
  const record = JSON.parse(await fsp.readFile(recordPath, 'utf8'));
  record.expiresAt = 1;
  await fsp.writeFile(recordPath, JSON.stringify(record));
  assert.equal(await auth.sessionIsValid(changed), false);
  await auth.cleanupSessions();
  assert.equal(fs.existsSync(recordPath), false);
});

test('JSON deadlines reject stalled bodies even when the received prefix is valid JSON', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('{"ok":true}')); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost/test', { method: 'POST', body, duplex: 'half' });
  const reading = readJsonBody(request, 32);
  context.mock.timers.tick(15000);
  await assert.rejects(reading, fails(408));
  assert.equal(cancelled, true);
});

test('concurrent credential attempts share a durable budget and recover after its window', async () => {
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => auth.verifyCredentials('name-' + i, 'wrong')));
  assert.equal(attempts.filter(x => x.status === 'fulfilled' && x.value === false).length, 3);
  assert.equal(attempts.filter(x => x.status === 'rejected' && x.reason.status === 429).length, 3);
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(compiled, 'auth-state.js'))}).verifyCredentials('test-admin','test-password').then(()=>process.exit(1),e=>process.exit(e.status===429?0:2))`], { env: process.env, timeout: 5000 });
  assert.equal(child.status, 0, 'limiter did not persist across process restart');
  await delay(1050);
  assert.equal(await auth.verifyCredentials('test-admin', 'test-password'), true);
});
