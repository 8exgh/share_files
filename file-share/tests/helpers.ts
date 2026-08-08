import path from 'path';
import { expect, Locator, Page } from '@playwright/test';
import { UploadedFile } from '../types';

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-password-123';
export const STORAGE_STATE = path.join(__dirname, '../test-results/.auth/admin.json');

export function uniqueName(base: string, ext: string): string {
  return `${base}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}${ext}`;
}

/** Upload a file through the dashboard's file input and return the API result. */
export async function uploadFile(
  page: Page,
  filename: string,
  content: string | Buffer
): Promise<UploadedFile> {
  const buffer = typeof content === 'string' ? Buffer.from(content) : content;
  const responsePromise = page.waitForResponse('**/api/upload');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer });
  const response = await responsePromise;
  const json = await response.json();
  expect(json.success, `upload failed: ${json.message}`).toBe(true);
  return json.data as UploadedFile;
}

/** Create a note through the dashboard UI and return the API result. */
export async function createNote(
  page: Page,
  content: string,
  name?: string
): Promise<UploadedFile> {
  // First "Create Note" button toggles the form open; the one inside the
  // expanded panel submits it.
  await page.getByRole('button', { name: 'Create Note' }).first().click();
  if (name !== undefined) {
    await page.getByLabel(/^Name/).fill(name);
  }
  await page.getByLabel('Content').fill(content);
  const responsePromise = page.waitForResponse('**/api/note');
  await page.getByRole('button', { name: 'Create Note' }).last().click();
  const response = await responsePromise;
  const json = await response.json();
  expect(json.success, `note creation failed: ${json.message}`).toBe(true);
  return json.data as UploadedFile;
}

/** The desktop table row for a given filename. */
export function fileRow(page: Page, filename: string): Locator {
  return page.getByRole('row').filter({ hasText: filename });
}
