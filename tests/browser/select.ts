import type { Locator, Page } from '@playwright/test';

/**
 * Picks an option in the shared dropdown (src/ui/components/Select.tsx) the way `selectOption`
 * does for a native select: by the value the option carries, after finding the control by its
 * label. The list opens in the page, so options are looked up on the page.
 */
export async function choose(scope: Page | Locator, label: string, value: string) {
  const page = 'page' in scope ? scope.page() : scope;
  await scope.getByLabel(label, { exact: true }).click();
  await page.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}

/** The same, picking the option by the text it shows (like selectOption with a label). */
export async function chooseByText(scope: Page | Locator, label: string, text: string) {
  const page = 'page' in scope ? scope.page() : scope;
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: text, exact: true }).click();
}
