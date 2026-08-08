import { expect, test } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './helpers';

test.describe('authentication', () => {
  // These tests exercise the unauthenticated experience.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
    await expect(page.getByPlaceholder('Username')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Username').fill(ADMIN_USERNAME);
    await page.getByPlaceholder('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
  });

  test('redirects unauthenticated visitors from /admin to the login page', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
  });

  test('rejects unauthenticated API access', async ({ request }) => {
    const list = await request.get('/api/files');
    expect(list.status()).toBe(401);

    const note = await request.post('/api/note', { data: { content: 'nope' } });
    expect(note.status()).toBe(401);

    const upload = await request.post('/api/upload', {
      multipart: {
        file: { name: 'nope.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') },
      },
    });
    expect(upload.status()).toBe(401);
  });

  test('logs in and out', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Username').fill(ADMIN_USERNAME);
    await page.getByPlaceholder('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'File Manager' })).toBeVisible();

    // Session survives a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'File Manager' })).toBeVisible();

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();

    // Session is gone: /admin bounces back to the login page.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
  });
});
