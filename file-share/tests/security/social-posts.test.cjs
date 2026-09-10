const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const app = path.resolve(__dirname, '../..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'social-post-test-'));
const compiled = path.join(fixture, 'compiled'); fs.mkdirSync(compiled);
fs.symlinkSync(path.join(app, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
for (const name of fs.readdirSync(path.join(app, 'lib')).filter(n => n.endsWith('.ts'))) {
  fs.writeFileSync(path.join(compiled, name.replace(/\.ts$/, '.js')), ts.transpileModule(fs.readFileSync(path.join(app, 'lib', name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
Object.assign(process.env, { UPLOAD_DIR: path.join(fixture, 'uploads'), MAX_FILE_SIZE: '1024', MAX_STORAGE_SIZE: '65536' });
const social = require(path.join(compiled, 'social-posts.js'));
const storage = require(path.join(compiled, 'storage.js'));
const { reserveUpload } = require(path.join(compiled, 'transfers.js'));
const { downloadStream } = require(path.join(compiled, 'download.js'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function request(title = 'Launch post', description = 'A useful update.', bytes, name = 'image.png') {
  const body = new FormData(); body.append('title', title); body.append('description', description);
  if (bytes) body.append('file', new Blob([bytes], { type: 'image/png' }), name);
  return new Request('http://localhost/api/social-posts', { method: 'POST', body });
}
beforeEach(async () => { await fsp.rm(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
after(async () => { await fsp.rm(fixture, { recursive: true, force: true }); });

test('text-only posts persist, archive after both platforms, and can return to the queue', async () => {
  const created = await social.createSocialPost(request());
  assert.equal(created.asset, undefined);
  assert.equal(created.archived, false);
  assert.equal((await social.updateSocialPost(created.id, { postedToTwitter: true })).archived, false);
  const both = await social.updateSocialPost(created.id, { postedToLinkedIn: true });
  assert.equal(both.archived, true);
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(compiled, 'social-posts.js'))}).getSocialPost(${JSON.stringify(created.id)}).then(p=>process.exit(p.archived?0:1))`], { env: process.env, timeout: 5000 });
  assert.equal(child.status, 0, child.stderr?.toString());
  assert.equal((await social.updateSocialPost(created.id, { postedToTwitter: false })).archived, false);
});

test('concurrent platform updates preserve both statuses', async () => {
  const post = await social.createSocialPost(request());
  await Promise.all([social.updateSocialPost(post.id, { postedToTwitter: true }), social.updateSocialPost(post.id, { postedToLinkedIn: true })]);
  const saved = await social.getSocialPost(post.id);
  assert.equal(saved.postedToTwitter, true); assert.equal(saved.postedToLinkedIn, true); assert.equal(saved.archived, true);
});

test('attachments survive ordinary file cleanup and cannot use public share URLs', async () => {
  const post = await social.createSocialPost(request('Image post', 'Draft description.', png));
  assert.equal(post.asset.kind, 'image'); assert.equal(post.asset.mimeType, 'image/png');
  assert.deepEqual(await storage.listFiles(), []);
  assert.equal(await storage.openFile(post.id, 'image.png'), null);
  await storage.cleanupExpiredFiles(-1);
  const opened = await social.openSocialAsset(post.id);
  const data = await new Response(downloadStream(opened.handle, new AbortController().signal, () => {})).arrayBuffer();
  assert.deepEqual(Buffer.from(data), png);
  await social.deleteSocialPost(post.id);
  await assert.rejects(social.getSocialPost(post.id), e => e.status === 404);
  assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, '.social-posts', post.id)), false);
});

test('invalid and oversized assets or missing text leave no orphaned files', async () => {
  for (const invalid of [request(' ', 'Description', png), request('Title', ' '), request('Title', 'Description', Buffer.from('<script>alert(1)</script>')), request('Title', 'Description', Buffer.alloc(1025))]) {
    await assert.rejects(social.createSocialPost(invalid), e => e.status === 400 || e.status === 413);
  }
  assert.deepEqual(await social.listSocialPosts(), []);
  assert.deepEqual(await fsp.readdir(path.join(process.env.UPLOAD_DIR, '.pending')), []);
});

test('only boolean platform updates are accepted and IDs cannot escape storage', async () => {
  const post = await social.createSocialPost(request());
  for (const data of [{ archived: true }, { postedToTwitter: 'true' }, { title: 'overwrite' }, {}]) {
    await assert.rejects(social.updateSocialPost(post.id, data), e => e.status === 400);
  }
  await assert.rejects(social.getSocialPost('../.security'), e => e.status === 404);
  await assert.rejects(social.getSocialPost(randomUUID()), e => e.status === 404);
});

test('social post records and attachments count toward the shared disk quota', async () => {
  await social.createSocialPost(request('Quota post', 'Has an image.', png));
  const directory = path.join(process.env.UPLOAD_DIR, randomUUID()); await fsp.mkdir(directory);
  await fsp.writeFile(path.join(directory, 'existing.bin'), Buffer.alloc(65535));
  await assert.rejects(reserveUpload(1), e => e.status === 507);
});
