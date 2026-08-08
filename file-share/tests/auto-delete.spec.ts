import { expect, test } from '@playwright/test';
import { fileRow, uniqueName, uploadFile } from './helpers';

test.describe('auto-delete and pinning', () => {
  test('new uploads default to auto-delete and can be pinned', async ({ page }) => {
    await page.goto('/admin');
    const uploaded = await uploadFile(page, uniqueName('pin-me', '.txt'), 'pin this');

    // Fresh uploads are marked for auto-deletion after an hour.
    const row = fileRow(page, uploaded.filename);
    await expect(row.getByRole('button', { name: 'Auto-delete' })).toBeVisible();

    // Pinning flips the status.
    await row.getByRole('button', { name: 'Auto-delete' }).click();
    await expect(row.getByRole('button', { name: 'Pinned' })).toBeVisible();

    // The pin survives a reload (it is persisted on disk, not just UI state).
    await page.reload();
    const rowAfterReload = fileRow(page, uploaded.filename);
    await expect(rowAfterReload.getByRole('button', { name: 'Pinned' })).toBeVisible();

    // And it can be flipped back.
    await rowAfterReload.getByRole('button', { name: 'Pinned' }).click();
    await expect(rowAfterReload.getByRole('button', { name: 'Auto-delete' })).toBeVisible();
  });
});
