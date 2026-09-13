const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const app = path.resolve(__dirname, '../..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-file-test-'));
const compiled = path.join(fixture, 'compiled'); fs.mkdirSync(compiled);
fs.symlinkSync(path.join(app, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
for (const name of fs.readdirSync(path.join(app, 'lib')).filter(n => n.endsWith('.ts'))) {
  fs.writeFileSync(path.join(compiled, name.replace(/\.ts$/, '.js')), ts.transpileModule(fs.readFileSync(path.join(app, 'lib', name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
Object.assign(process.env, { UPLOAD_DIR: path.join(fixture, 'uploads'), MAX_FILE_SIZE: '1024', MAX_NOTE_SIZE: '128', MAX_STORAGE_SIZE: '20000', MAX_ANONYMOUS_STORAGE_SIZE: '12000', MAX_ANONYMOUS_FILES: '3' });
const anonymous = require(path.join(compiled, 'anonymous-files.js'));
const storage = require(path.join(compiled, 'storage.js'));
const { reserveUpload } = require(path.join(compiled, 'transfers.js'));
const headers = { 'cf-connecting-ip': '127.0.0.1', 'cf-ipcountry': 'CA' };
function upload(bytes = Buffer.from('hello'), name = 'file.txt', fields = {}) {
  const body = new FormData(); body.append('file', new Blob([bytes]), name);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new Request('http://localhost/api/anonymous-files', { method: 'POST', body, headers });
}
function note(content = 'A note.\n<script>plain text</script>', extra = {}) {
  return new Request('http://localhost/api/anonymous-notes', { method: 'POST', headers, body: JSON.stringify({ content, ...extra }) });
}
beforeEach(async () => { await fsp.rm(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
after(async () => { await fsp.rm(fixture, { recursive: true, force: true }); });

test('public files hash the exact bytes and persist only masked uploader metadata', async () => {
  const bytes = Buffer.alloc(1024, 7);
  const file = await anonymous.saveAnonymousFile(upload(bytes));
  assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(file.maskedIp, '0.1'); assert.equal(file.countryCode, 'CA');
  assert.equal(Date.parse(file.expiresAt) - Date.parse(file.uploadDate), 86400000);
  const record = await fsp.readFile(path.join(process.env.UPLOAD_DIR, '.anonymous', file.id, '.file.json'), 'utf8');
  assert.equal(record.includes('127.0.0.1'), false);
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(compiled, 'anonymous-files.js'))}).getAnonymousFile(${JSON.stringify(file.id)}).then(f=>process.exit(f.sha256===${JSON.stringify(file.sha256)}?0:1))`], { env: process.env, timeout: 5000 });
  assert.equal(child.status, 0, child.stderr?.toString());
  assert.deepEqual(await storage.listFiles(), []);
  assert.equal(await storage.openFile(file.id, file.filename), null);
  assert.equal(await storage.setAutoDelete(file.id, false), false);
  await storage.cleanupExpiredFiles(-1);
  assert.equal((await anonymous.listAnonymousFiles()).length, 1);
});

test('files and notes expire at exactly 24 hours and expired bytes are reclaimed', async () => {
  const file = await anonymous.saveAnonymousFile(upload());
  const savedNote = await anonymous.saveAnonymousNote(note());
  const actualNow = Date.now;
  try {
    Date.now = () => Date.parse(file.expiresAt) - 1;
    assert.equal((await anonymous.getAnonymousFile(file.id)).id, file.id);
    Date.now = () => Date.parse(file.expiresAt);
    await assert.rejects(anonymous.openAnonymousFile(file.id, file.filename), e => e.status === 404);
    assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, '.anonymous', file.id)), false);
    Date.now = () => Date.parse(savedNote.expiresAt);
    assert.deepEqual(await anonymous.cleanupAnonymousFiles(), [savedNote.id]);
    assert.deepEqual(await anonymous.listAnonymousFiles(), []);
  } finally { Date.now = actualNow; }
});

test('notes preserve UTF-8 text and get a view link and the correct hash', async () => {
  const content = '<script>alert(1)</script>\n你好 🌎\n';
  const saved = await anonymous.saveAnonymousNote(note(content, { name: 'Public note' }));
  assert.equal(saved.filename, 'Public note.txt'); assert.equal(saved.kind, 'note');
  assert.equal(saved.viewUrl, saved.downloadUrl + '?view=1');
  assert.equal(saved.sha256, createHash('sha256').update(content).digest('hex'));
  const opened = await anonymous.openAnonymousFile(saved.id, saved.filename);
  try { assert.equal(await opened.handle.readFile('utf8'), content); } finally { await opened.handle.close(); }
});

test('retention overrides, oversize bodies and metadata/path attacks are rejected without leftovers', async () => {
  for (const request of [upload(Buffer.alloc(1025)), upload(Buffer.from('x'), '.file.json'), upload(Buffer.from('x'), 'x.txt', { autoDelete: 'false' }), upload(Buffer.from('x'), 'x.txt', { expiresAt: '2099-01-01' })]) {
    await assert.rejects(anonymous.saveAnonymousFile(request), e => [400, 413].includes(e.status));
  }
  for (const request of [note(' '), note('é'.repeat(65)), note('test', { autoDelete: false }), note('test', { name: '.file.json' })]) {
    await assert.rejects(anonymous.saveAnonymousNote(request), e => [400, 413].includes(e.status));
  }
  await assert.rejects(anonymous.getAnonymousFile('../.security'), e => e.status === 404);
  assert.deepEqual(await anonymous.listAnonymousFiles(), []);
  assert.deepEqual(await fsp.readdir(path.join(process.env.UPLOAD_DIR, '.pending')), []);
});

test('IP masking handles IPv4, IPv6, mapped addresses and missing metadata', async () => {
  for (const [input, expected] of [['127.0.0.1', '0.1'], ['203.0.113.42', '113.42'], ['::1', '0:1'], ['2001:db8::abcd:1234', 'abcd:1234'], ['::ffff:127.0.0.1', '0.1'], ['0:0:0:0:0:ffff:7f00:1', '0.1'], ['nonsense', 'Unknown']]) assert.equal(anonymous.maskIp(input), expected);
  const request = note('Unknown visitor');
  request.headers.delete('cf-connecting-ip'); request.headers.set('cf-ipcountry', '<script>');
  const saved = await anonymous.saveAnonymousNote(request);
  assert.equal(saved.maskedIp, 'Unknown'); assert.equal(saved.countryCode, null);
});

test('anonymous quota includes active reservations and leaves separate capacity for admin uploads', async () => {
  const release = await reserveUpload(7000, true);
  try {
    await assert.rejects(reserveUpload(6000, true), e => e.status === 507);
    const admin = await reserveUpload(6000); admin();
  } finally { release(); }
  const saved = await anonymous.saveAnonymousFile(upload());
  const used = (await fsp.stat(path.join(process.env.UPLOAD_DIR, '.anonymous', saved.id, '.file.json'))).size + saved.size;
  await assert.rejects(reserveUpload(12001 - used, true), e => e.status === 507);
  const other = path.join(process.env.UPLOAD_DIR, randomUUID()); await fsp.mkdir(other);
  await fsp.writeFile(path.join(other, 'admin.bin'), Buffer.alloc(19999 - used));
  await assert.rejects(reserveUpload(2, true), e => e.status === 507);
});


test('public concurrency is bounded without consuming every admin transfer slot', async () => {
  const first = await reserveUpload(1, true);
  const second = await reserveUpload(1, true);
  try {
    await assert.rejects(reserveUpload(1, true), e => e.status === 503);
    const admin = await reserveUpload(1); admin();
  } finally { first(); second(); }
});

test('public entry counts prevent empty uploads from exhausting directory capacity', async () => {
  for (let i = 0; i < 3; i++) await anonymous.saveAnonymousFile(upload(Buffer.alloc(0), `empty-${i}.txt`));
  await assert.rejects(anonymous.saveAnonymousFile(upload()), e => e.status === 507);
  assert.equal((await anonymous.listAnonymousFiles()).length, 3);
  const admin = await reserveUpload(1); admin();
});
