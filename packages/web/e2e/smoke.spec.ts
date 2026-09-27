import { expect, test } from '@playwright/test';

/**
 * Smoke test against a running server (BASE_URL, default http://localhost:8080):
 * register -> open stage 1 -> answer one question correctly -> summon a unit -> see it on the field.
 */
test('register, play a stage, answer, summon', async ({ page }) => {
  const user = `e2e_${Date.now().toString(36)}`;
  await page.goto('/');
  await page.getByRole('button', { name: /建立一個/ }).click();
  await page.getByPlaceholder(/帳號/).fill(user);
  await page.getByPlaceholder(/顯示名稱/).fill('煙霧貓');
  await page.getByPlaceholder(/密碼/).fill('smoketest123');
  await page.getByRole('button', { name: '建立帳號' }).click();

  await expect(page.getByText('關卡模式')).toBeVisible();
  await page.getByText('關卡模式').click();
  await page.getByText('櫃檯實習').click();

  // battle mounted: canvas + quiz
  await expect(page.locator('.battle-top canvas')).toBeVisible();
  await expect(page.locator('.q-text')).not.toHaveText(/載入中/, { timeout: 15_000 });

  // answer correctly using the API as the oracle (the UI never reveals the answer before choosing)
  const token = await page.evaluate(() => localStorage.getItem('catfight.token'));
  const qs = (await (await page.request.get('/api/questions?category=finance_basics&limit=100', { headers: { authorization: `Bearer ${token}` } })).json()) as {
    text: string;
    answerIndex: number;
  }[];
  const answers = new Map(qs.map((q) => [q.text, q.answerIndex]));

  let score = 0;
  for (let i = 0; i < 3; i++) {
    const text = (await page.locator('.q-text').textContent())!.trim();
    const idx = answers.get(text);
    expect(idx, `unknown question: ${text}`).not.toBeUndefined();
    await page.locator('.opt').nth(idx!).click();
    await expect(page.locator('.opt').nth(idx!)).toHaveClass(/correct/);
    score += 10;
    await expect(page.locator('#score')).toHaveText(String(score));
    await page.waitForTimeout(400);
  }

  const tank = page.locator('.unit-btn').first();
  await expect(tank).toBeEnabled();
  await tank.click();
  await expect(page.locator('#score')).toHaveText('0');

  await expect(tank).toBeDisabled();
  const entities = await page.evaluate(() => (window as unknown as { __cf: { entities: number } }).__cf.entities);
  expect(entities).toBe(1);
});
