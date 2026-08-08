import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { fileRow, uniqueName, uploadFile } from './helpers';

test.describe('file upload and sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
  });

  test('uploads a file and shows it in the list', async ({ page }) => {
    const filename = uniqueName('hello', '.txt');
    await uploadFile(page, filename, 'Hello, world!');

    const row = fileRow(page, filename);
    await expect(row).toBeVisible();
    await expect(row).toContainText('13 Bytes');
    await expect(row.getByRole('button', { name: 'Auto-delete' })).toBeVisible();
  });

  test('anyone with the link can download the file without logging in', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const content = `top secret payload ${Date.now()}`;
    const uploaded = await uploadFile(page, uniqueName('shared', '.txt'), content);

    // A fresh request context carries no session cookie: this is a stranger
    // opening the share link.
    const anonymous = await playwright.request.newContext({ baseURL });
    const response = await anonymous.get(uploaded.downloadUrl);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(content);
    expect(response.headers()['content-disposition']).toContain('attachment');
    await anonymous.dispose();
  });

  test('copy link puts the share URL on the clipboard', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const uploaded = await uploadFile(page, uniqueName('copy-me', '.txt'), 'copy me');

    const row = fileRow(page, uploaded.filename);
    await row.getByRole('button', { name: 'Copy Link' }).click();
    await expect(row.getByRole('button', { name: 'Copied!' })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(`${baseURL}${uploaded.downloadUrl}`);
  });

  test('deletes a file', async ({ page, playwright, baseURL }) => {
    const uploaded = await uploadFile(page, uniqueName('delete-me', '.txt'), 'goodbye');
    const row = fileRow(page, uploaded.filename);
    await expect(row).toBeVisible();

    page.on('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);

    // The share link is dead too.
    const anonymous = await playwright.request.newContext({ baseURL });
    const response = await anonymous.get(uploaded.downloadUrl);
    expect(response.status()).toBe(404);
    await anonymous.dispose();
  });

  test('unknown or malformed links return 404', async ({ page, playwright, baseURL }) => {
    const uploaded = await uploadFile(page, uniqueName('present', '.txt'), 'here');

    const anonymous = await playwright.request.newContext({ baseURL });

    const malformed = await anonymous.get('/f/not-a-uuid/file.txt');
    expect(malformed.status()).toBe(404);

    const unknown = await anonymous.get(`/f/${randomUUID()}/file.txt`);
    expect(unknown.status()).toBe(404);

    const wrongName = await anonymous.get(`/f/${uploaded.id}/some-other-file.txt`);
    expect(wrongName.status()).toBe(404);

    await anonymous.dispose();
  });
});
