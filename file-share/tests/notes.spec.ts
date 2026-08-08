import { expect, test } from '@playwright/test';
import { createNote, fileRow, uniqueName } from './helpers';

test.describe('inline notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
  });

  test('creates a note with a custom name and serves it as a text file', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const name = uniqueName('meeting-notes', '');
    const content = 'Agenda:\n1. Ship it\n2. Celebrate';
    const note = await createNote(page, content, name);

    expect(note.filename).toBe(`${name}.txt`);
    await expect(fileRow(page, note.filename)).toBeVisible();

    const anonymous = await playwright.request.newContext({ baseURL });
    const response = await anonymous.get(note.downloadUrl);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(content);
    expect(response.headers()['content-type']).toContain('text/plain');
    await anonymous.dispose();
  });

  test('names notes with a timestamp by default', async ({ page }) => {
    const note = await createNote(page, 'quick unnamed note');
    expect(note.filename).toMatch(/^Note_\d{4}_\d{2}_\d{2}___\d{2}_\d{2}_\d{2}\.txt$/);
    await expect(fileRow(page, note.filename)).toBeVisible();
  });

  test('refuses to create an empty note', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Note' }).first().click();
    await page.getByRole('button', { name: 'Create Note' }).last().click();
    await expect(page.getByText('Note content cannot be empty')).toBeVisible();
  });
});
