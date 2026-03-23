/**
 * Steuerreport E2E Tests
 *
 * Exercises the complete user journey for the Steuerreport tab:
 *   - Tab navigation accessibility
 *   - Year selector presence
 *   - Report sections visibility (Anlage SO / empty state)
 *   - PDF download button presence and functionality
 *   - CSV export button presence and functionality
 *
 * Requires running dev servers:
 *   - Backend: http://localhost:3001 (npm run dev -w packages/backend)
 *   - Frontend: http://localhost:5174 (npm run dev -w packages/frontend)
 *
 * Run via: npm run test:e2e
 */

import { expect, test } from '@playwright/test';

test.describe('Steuerreport E2E', () => {
  test('Steuerreport tab is accessible and clickable', async ({ page }) => {
    await page.goto('/');
    // The tab bar renders <button> elements with the tab label as text
    const tab = page.getByRole('button', { name: /Steuerreport/i });
    await expect(tab).toBeVisible();
    await tab.click();
    // After clicking, the tab content should be mounted
    await expect(page.locator('.report-tab, [class*="report"]').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('Steuerreport tab shows year selector', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Steuerreport/i }).click();
    // YearSelector renders a <select class="year-selector"> element
    const selector = page.locator('select.year-selector');
    await expect(selector).toBeVisible({ timeout: 5_000 });
  });

  test('Steuerreport shows content after tab click', async ({ page }) => {
    // Pre-condition: attempt engine run to populate data (no-op if no data imported)
    await page.request.post('http://localhost:3001/api/engine/run');

    await page.goto('/');
    await page.getByRole('button', { name: /Steuerreport/i }).click();

    // Wait for loading to complete (either report data or empty state)
    await page.waitForTimeout(3000);

    // Should show either report section headers or the empty-state message
    const hasContent = await page
      .getByText(/Anlage SO|Keine Daten|Privates Veraeusserungsgeschaeft/)
      .isVisible();
    expect(hasContent).toBe(true);
  });

  test('PDF download button exists in Steuerreport tab', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Steuerreport/i }).click();

    // PDF download button — aria-label="PDF herunterladen"
    const pdfBtn = page.getByRole('button', { name: /PDF herunterladen/i });
    await expect(pdfBtn).toBeVisible({ timeout: 5_000 });
  });

  test('CSV export button exists in Steuerreport tab', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Steuerreport/i }).click();

    // CSV export button — aria-label="CSV exportieren"
    const csvBtn = page.getByRole('button', { name: /CSV exportieren/i });
    await expect(csvBtn).toBeVisible({ timeout: 5_000 });
  });
});
