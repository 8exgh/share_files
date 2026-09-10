import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './helpers';

const credentials = { username: ADMIN_USERNAME, password: ADMIN_PASSWORD };
const authorization = `Basic ${Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64')}`;

test('logout revokes a captured session without affecting other sessions', async ({ playwright, request, baseURL }) => {
  const isolated = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const login = await isolated.post('/api/auth/login', { data: credentials });
    expect(login.status()).toBe(200);
    const cookie = login.headers()['set-cookie'].split(';')[0];
    expect((await isolated.post('/api/auth/logout')).status()).toBe(200);
    expect((await isolated.get('/api/files', { headers: { cookie } })).status()).toBe(401);
    expect((await request.get('/api/files')).status()).toBe(200);
  } finally { await isolated.dispose(); }
});

test('oversized and malformed requests fail with controlled client errors', async ({ request }) => {
  expect((await request.post('/api/auth/login', { data: { username: 'x'.repeat(9000), password: 'wrong' } })).status()).toBe(413);
  expect((await request.post('/api/note', { data: { content: 'x', name: {} } })).status()).toBe(400);
  expect((await request.post('/api/note', { data: { content: 'x'.repeat(65537) } })).status()).toBe(413);
  const upload = await request.post('/api/upload', { multipart: {
    file: { name: 'too-large.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1048577) },
  } });
  expect(upload.status()).toBe(413);
  const malformed = await request.post('/api/upload', {
    headers: { 'content-type': 'multipart/form-data; boundary=broken' },
    data: '--broken\r\nContent-Disposition: form-data; name="file"; filename="incomplete.txt"\r\n\r\nincomplete',
  });
  expect(malformed.status()).toBe(400);
  const list = await request.get('/api/files');
  expect(list.status()).toBe(200);
  const names = (await list.json()).data.map((file: { filename: string }) => file.filename);
  expect(names).not.toContain('too-large.bin');
  expect(names).not.toContain('incomplete.txt');
});

test('public GET and HEAD retain download headers after streaming changes', async ({ request, playwright, baseURL }) => {
  const created = await request.post('/api/upload', { multipart: {
    file: { name: 'streamed.txt', mimeType: 'text/plain', buffer: Buffer.from('streamed download') },
  } });
  expect(created.status()).toBe(200);
  const file = (await created.json()).data;
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const get = await anonymous.get(file.downloadUrl);
    expect(get.status()).toBe(200);
    expect(await get.text()).toBe('streamed download');
    expect(get.headers()['content-disposition']).toContain('attachment');
    expect(get.headers()['x-content-type-options']).toBe('nosniff');
    const head = await anonymous.head(file.downloadUrl);
    expect(head.status()).toBe(200);
    expect(head.headers()['content-length']).toBe(String(Buffer.byteLength('streamed download')));
    expect(await head.body()).toHaveLength(0);
  } finally {
    await anonymous.dispose();
    await request.delete(`/api/files/${file.id}`);
  }
});

test('login and Basic auth share a password-attempt limit that expires', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await anonymous.post('/api/auth/login', { data: credentials })).status()).toBe(200);
    await anonymous.post('/api/auth/logout');
    for (let i = 0; i < 5; i++) {
      expect((await anonymous.post('/api/auth/login', { data: { ...credentials, password: `wrong-${i}` } })).status()).toBe(401);
    }
    const throttled = await anonymous.post('/api/upload', { headers: { authorization } });
    expect(throttled.status()).toBe(429);
    expect(Number(throttled.headers()['retry-after'])).toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const recovered = await anonymous.post('/api/upload', { headers: { authorization }, multipart: {
      file: { name: 'after-throttle.txt', mimeType: 'text/plain', buffer: Buffer.from('allowed') },
    } });
    expect(recovered.status()).toBe(200);
  } finally { await anonymous.dispose(); }
});
