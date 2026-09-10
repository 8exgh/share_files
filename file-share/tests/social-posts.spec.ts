import { expect, test } from '@playwright/test';
import { uniqueName } from './helpers';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('Social Posts tab creates, persists, archives, and restores a post', async ({ page, request, context }) => {
  const title = uniqueName('Queue update', '');
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Social Posts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Social Posts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add post', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('A post ready for both platforms.\nSecond paragraph.');
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/social-posts') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add to queue' }).click();
  const response = await createdResponse; expect(response.status()).toBe(201);
  const post = (await response.json()).data;
  try {
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row).toBeVisible(); await expect(row).toContainText('No attachment');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: 'Copy text' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Second paragraph.');
    await page.route(`**/api/social-posts/${post.id}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Please try again.' }) }), { times: 1 });
    await row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Please try again.' })).toBeVisible();
    await expect(row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` })).not.toBeChecked();
    await row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` }).check();
    await expect(row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` })).toBeChecked();
    await expect(row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` })).toBeEnabled();
    await page.reload();
    await expect(row.getByRole('checkbox', { name: `Posted to Twitter for ${title}` })).toBeChecked();
    await row.getByRole('checkbox', { name: `Posted to LinkedIn for ${title}` }).click();
    await expect(row).toHaveCount(0);
    const archived = page.getByRole('button', { name: /Show archived/ });
    await archived.click(); await expect(archived).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toContainText('Archived');
    await row.getByRole('checkbox', { name: `Posted to LinkedIn for ${title}` }).uncheck();
    await expect(row).not.toContainText('Archived');
    await archived.click(); await expect(row).toBeVisible();
    await page.reload(); await expect(row).toBeVisible();
  } finally { await request.delete(`/api/social-posts/${post.id}`); }
});

test('image posts show a thumbnail and keep attachments private', async ({ page, request, playwright, baseURL }) => {
  const title = uniqueName('Image post', '');
  await page.goto('/admin/social-posts'); await page.getByRole('button', { name: 'Add post', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('An image for the next announcement.');
  await page.getByLabel(/Image or video/).setInputFiles({ name: 'announcement.png', mimeType: 'image/png', buffer: png });
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/social-posts') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add to queue' }).click();
  const response = await createdResponse; expect(response.status()).toBe(201);
  const post = (await response.json()).data;
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const row = page.getByRole('row').filter({ hasText: title });
    await expect(row.getByRole('img')).toBeVisible();
    await expect.poll(() => row.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect((await anonymous.get(post.asset.url)).status()).toBe(401);
    expect((await anonymous.head(post.asset.url)).status()).toBe(401);
    expect((await anonymous.get('/api/social-posts')).status()).toBe(401);
    expect((await anonymous.post('/api/social-posts', { data: {} })).status()).toBe(401);
    expect((await anonymous.patch(`/api/social-posts/${post.id}`, { data: { postedToTwitter: true } })).status()).toBe(401);
    expect((await anonymous.delete(`/api/social-posts/${post.id}`)).status()).toBe(401);
    expect((await anonymous.get(`/f/${post.id}/announcement.png`)).status()).toBe(404);
    const asset = await request.get(post.asset.url); expect(asset.headers()['content-type']).toBe('image/png');
    expect(await asset.body()).toEqual(png);
    expect((await request.get(`${post.asset.url}?download=1`)).headers()['content-disposition']).toContain('attachment');
    const files = (await (await request.get('/api/files')).json()).data;
    expect(files.some((file: { id: string }) => file.id === post.id)).toBe(false);
  } finally { await anonymous.dispose(); await request.delete(`/api/social-posts/${post.id}`); }
});

test('video posts support playback byte ranges and mobile posting controls', async ({ page, request }) => {
  await page.goto('/admin/social-posts');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#4f46e5'; ctx.fillRect(0, 0, 64, 64);
    const stream = canvas.captureStream(10); const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const done = new Promise<Blob>(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.ondataavailable = event => chunks.push(event.data); recorder.start();
    await new Promise(resolve => setTimeout(resolve, 250)); recorder.stop();
    const blob = await done; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const title = uniqueName('Video post', '');
  const response = await request.post('/api/social-posts', { multipart: { title, description: 'A short update.', file: { name: 'update.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) } } });
  expect(response.status()).toBe(201); const post = (await response.json()).data;
  try {
    expect(post.asset.kind).toBe('video');
    const range = await request.get(post.asset.url, { headers: { range: 'bytes=0-15' } });
    expect(range.status()).toBe(206); expect(await range.body()).toEqual(Buffer.from(bytes.slice(0, 16)));
    expect(range.headers()['content-range']).toBe(`bytes 0-15/${bytes.length}`);
    const suffix = await request.get(post.asset.url, { headers: { range: 'bytes=-8' } });
    expect(suffix.status()).toBe(206); expect(await suffix.body()).toEqual(Buffer.from(bytes.slice(-8)));
    expect((await request.get(post.asset.url, { headers: { range: `bytes=${bytes.length}-` } })).status()).toBe(416);
    const head = await request.head(post.asset.url); expect(head.status()).toBe(200); expect(head.headers()['content-length']).toBe(String(bytes.length));
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    const card = page.getByRole('article', { name: title }); await expect(card).toBeVisible();
    await expect(card.locator('video')).toBeVisible();
    await expect.poll(() => card.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await card.getByRole('checkbox', { name: `Posted to Twitter for ${title}` }).check();
    await expect(card.getByRole('checkbox', { name: `Posted to Twitter for ${title}` })).toBeChecked();
    page.once('dialog', dialog => dialog.accept()); await card.getByRole('button', { name: 'Delete post' }).click();
    await expect(card).toHaveCount(0); expect((await request.get(post.asset.url)).status()).toBe(404);
  } finally { await request.delete(`/api/social-posts/${post.id}`); }
});
