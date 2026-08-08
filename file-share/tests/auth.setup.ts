import { expect, test as setup } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, STORAGE_STATE } from './helpers';

setup('log in as admin', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill(ADMIN_USERNAME);
  await page.getByPlaceholder('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'File Manager' })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
