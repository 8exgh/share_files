import { expect, Page, test } from '@playwright/test';
import path from 'path';

// Regenerates the screenshots embedded in the repository README.
// Run with: npm run screenshots

const SCREENSHOT_DIR = path.join(__dirname, '../../docs/screenshots');

const shot = (name: string) => path.join(SCREENSHOT_DIR, name);

// The dev server renders a dev-tools indicator in the corner; keep it out of
// the screenshots.
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

async function wipeAllFiles(page: Page) {
  const response = await page.request.get('/api/files');
  const files = (await response.json()).data || [];
  for (const file of files) {
    await page.request.delete(`/api/files/${file.id}`);
  }
}

test.describe('admin screens', () => {
  test('dashboard, note form, and copy link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/admin');
    await wipeAllFiles(page);

    // Seed files that make the dashboard look lived-in.
    const seed = async (name: string, mimeType: string, size: number) => {
      const response = await page.request.post('/api/upload', {
        multipart: { file: { name, mimeType, buffer: Buffer.alloc(size, 7) } },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data;
    };

    const report = await seed('Quarterly_Report_Q3.pdf', 'application/pdf', 2_517_000);
    await seed('team_offsite_photo.jpg', 'image/jpeg', 883_000);
    await seed('product_demo.mp4', 'video/mp4', 4_830_000);
    const note = await page.request.post('/api/note', {
      data: {
        name: 'Deployment_Checklist',
        content:
          'Deployment checklist:\n[x] Run test suite\n[x] Build Docker image\n[ ] Tag release v1.4.0\n[ ] Deploy to production\n',
      },
    });
    expect(note.ok()).toBeTruthy();

    // Pin the report so both statuses show up in the list.
    const pin = await page.request.patch(`/api/files/${report.id}`, {
      data: { autoDelete: false },
    });
    expect(pin.ok()).toBeTruthy();

    await page.goto('/admin');
    await hideDevOverlay(page);
    await expect(page.getByRole('cell', { name: 'Quarterly_Report_Q3.pdf' })).toBeVisible();
    await page.screenshot({ path: shot('dashboard.png'), fullPage: true });

    // Note form, expanded and filled in.
    await page.getByRole('button', { name: 'Create Note' }).first().click();
    await page.getByLabel(/^Name/).fill('Server_Access_Notes');
    await page
      .getByLabel('Content')
      .fill('Staging server: ssh deploy@staging.example.com\nGrafana: https://grafana.example.com\n');
    await page
      .locator('div')
      .filter({ has: page.getByLabel('Content') })
      .last()
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('create-note.png'), fullPage: true });
    // Collapse the form again.
    await page.getByRole('button', { name: 'Create Note' }).first().click();

    // Copy link feedback state.
    const row = page.getByRole('row').filter({ hasText: 'Quarterly_Report_Q3.pdf' });
    await row.getByRole('button', { name: 'Copy Link' }).click();
    await expect(row.getByRole('button', { name: 'Copied!' })).toBeVisible();
    await page.screenshot({ path: shot('copy-link.png'), fullPage: true });
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('dashboard on a phone', async ({ page }) => {
    await page.goto('/admin');
    await hideDevOverlay(page);
    await expect(page.getByText('Quarterly_Report_Q3.pdf').filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: shot('mobile.png'), fullPage: false });
  });
});

test.describe('login screen', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page', async ({ page }) => {
    await page.goto('/');
    await hideDevOverlay(page);
    await expect(page.getByRole('heading', { name: 'Admin Login' })).toBeVisible();
    await page.screenshot({ path: shot('login.png'), fullPage: false });
  });
});
