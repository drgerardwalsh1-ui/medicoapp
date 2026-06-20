export async function runPTSDIntake(window) {
  await window.click('text=New Assessment');

  const input = window.locator('[data-testid="symptom-input"]');

  await input.fill('flashbacks');
  await input.press('Enter');

  await input.fill('nightmares');
  await input.press('Enter');

  await input.fill('hypervigilance');
  await input.press('Enter');

  await window.click('text=Continue');
}