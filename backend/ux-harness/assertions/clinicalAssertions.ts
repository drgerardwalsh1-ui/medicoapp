import { expect } from '@playwright/test';

export async function assertPTSDTransition(window) {
  await expect(window.locator('text=Risk Assessment')).toBeVisible();
}
