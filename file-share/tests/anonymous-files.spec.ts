import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, uniqueName } from './helpers';

test.describe('anonymous files and notes', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('logged-out visitors upload files with masked IP, country, hash and public download', async ({ page, request, context }) => {
    const name = uniqueName('anonymous', '.txt');
    const content = 'Public upload bytes\n';
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': '127.0.0.1', 'CF-IPCountry': 'CA' });
    await page.clock.install();
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Anonymous files', exact: true });
    await expect(section).toBeVisible();
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/anonymous-files') && response.request().method() === 'POST');
    await page.getByLabel('Anonymous file', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
    const response = await responsePromise; expect(response.status()).toBe(201);
    const file = (await response.json()).data;
    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row).toContainText('IP 0.1'); await expect(row).toContainText('CA');
    await expect(row).toContainText(createHash('sha256').update(content).digest('hex'));
    await expect(row).toContainText('24h 0m left');
    expect(Date.parse(file.expiresAt) - Date.parse(file.uploadDate)).toBe(86400000);
    expect(await response.text()).not.toContain('127.0.0.1');
    expect(await section.getByRole('checkbox').count()).toBe(0);
    const download = await request.get(file.downloadUrl);
    expect(download.status()).toBe(200); expect(await download.text()).toBe(content);
    expect(download.headers()['content-disposition']).toContain('attachment');
    expect(download.headers()['cache-control']).toContain('no-store');
    const head = await request.head(file.downloadUrl); expect(head.status()).toBe(200);
    expect(head.headers()['content-length']).toBe(String(Buffer.byteLength(content)));
    expect((await request.get(`/f/${file.id}/${name}`)).status()).toBe(404);
    await page.reload(); await expect(row).toBeVisible();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(file.downloadUrl);
    // The client removes expired entries even if no refresh has happened yet.
    await page.clock.setSystemTime(new Date(file.expiresAt)); await page.clock.runFor(1000);
    await expect(row).toHaveCount(0);
  });

  test('anonymous notes expose safe plain-text view links on mobile', async ({ page, request, context }) => {
    const name = uniqueName('Public note', '');
    const content = '<script>window.executed = true</script>\nA note anyone can view. 你好';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create anonymous note', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create anonymous note' });
    await form.getByLabel('Name').fill(name); await form.getByLabel('Content').fill(content);
    const created = page.waitForResponse('**/api/anonymous-notes');
    await form.getByRole('button', { name: 'Create note & view link' }).click();
    const response = await created; expect(response.status()).toBe(201); const note = (await response.json()).data;
    const row = page.getByRole('listitem').filter({ hasText: name }); await expect(row).toBeVisible();
    await expect(row).toContainText('Unknown');
    const view = await request.get(note.viewUrl); expect(view.status()).toBe(200); expect(await view.text()).toBe(content);
    expect(view.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(view.headers()['content-disposition']).toContain('inline');
    expect(view.headers()['x-content-type-options']).toBe('nosniff');
    expect(view.headers()['content-security-policy']).toContain('sandbox');
    const popupPromise = page.waitForEvent('popup'); await row.getByRole('link', { name: 'View note' }).click();
    const popup = await popupPromise; await expect(popup.locator('body')).toContainText(content);
    expect(await popup.evaluate(() => (window as unknown as { executed?: boolean }).executed)).toBeUndefined();
    await popup.close();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']); await row.getByRole('button', { name: 'Copy link' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(note.viewUrl);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload(); await expect(row).toBeVisible();
    await page.getByPlaceholder('Username').fill(ADMIN_USERNAME); await page.getByPlaceholder('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'File Manager' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Anonymous files', exact: true })).toHaveCount(0);
    expect((await (await page.request.get('/api/files')).json()).data.some((file: { id: string }) => file.id === note.id)).toBe(false);
    await page.goto('/'); await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole('link', { name: 'Social Posts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Anonymous files', exact: true })).toHaveCount(0);
  });

  test('public endpoints reject pinning, oversized content and unsafe uploads', async ({ request }) => {
    const upload = (fields = {}) => request.post('/api/anonymous-files', { multipart: { file: { name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, ...fields } });
    expect((await upload({ autoDelete: 'false' })).status()).toBe(400);
    expect((await request.patch('/api/anonymous-files', { data: { autoDelete: false } })).status()).toBe(405);
    expect((await request.post('/api/anonymous-notes', { data: { content: 'text', autoDelete: false } })).status()).toBe(400);
    expect((await request.post('/api/anonymous-notes', { data: { content: ' ' } })).status()).toBe(400);
    expect((await request.post('/api/anonymous-notes', { data: { content: 'é'.repeat(32769) } })).status()).toBe(413);
    expect((await request.post('/api/anonymous-files', { multipart: { file: { name: 'large.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1048577) } } })).status()).toBe(413);
    expect((await request.post('/api/anonymous-files', { multipart: { file: { name: '.file.json', mimeType: 'application/json', buffer: Buffer.from('{}') } } })).status()).toBe(400);
    const html = await request.post('/api/anonymous-files', { multipart: { file: { name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') } } });
    expect(html.status()).toBe(201); const file = (await html.json()).data;
    const viewAttempt = await request.get(file.downloadUrl + '?view=1');
    expect(viewAttempt.headers()['content-type']).toBe('application/octet-stream');
    expect(viewAttempt.headers()['content-disposition']).toContain('attachment');
  });
});
