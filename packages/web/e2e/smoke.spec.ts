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

  // with an empty question bank the stage list shows a hint and the test ends here
  const first = page.locator('#list .list-btn').first();
  const empty = page.getByText('題庫還是空的');
  await expect(first.or(empty)).toBeVisible();
  if (await empty.isVisible()) return;
  const category = await page.evaluate(async (t) => {
    const st = await (await fetch('/api/stages', { headers: { authorization: `Bearer ${t}` } })).json();
    return st[0].category as string;
  }, await page.evaluate(() => localStorage.getItem('catfight.token')));
  await first.click();

  // battle mounted: canvas + quiz
  await expect(page.locator('.battle-top canvas')).toBeVisible();
  await expect(page.locator('.q-text')).not.toHaveText(/載入中/, { timeout: 15_000 });

  // answer correctly using the API as the oracle (the UI never reveals the answer before choosing)
  const token = await page.evaluate(() => localStorage.getItem('catfight.token'));
  // page through the bank (max 100 per call) so the oracle covers every question that can appear
  const qs: { id: number; text: string; options: string[]; answerIndex: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const ex = qs.map((q) => q.id).join(',');
    const page_ = (await (
      await page.request.get(`/api/questions?category=${category}&limit=100${ex ? `&exclude=${ex}` : ''}`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as typeof qs;
    const fresh = page_.filter((q) => !qs.some((k) => k.id === q.id));
    qs.push(...fresh);
    if (fresh.length < 100) break;
  }
  const answers = new Map(qs.map((q) => [q.text, q.options[q.answerIndex]]));

  let score = 0;
  for (let i = 0; i < 3; i++) {
    const text = (await page.locator('.q-text').textContent())!.trim();
    const correct = answers.get(text);
    expect(correct, `unknown question: ${text}`).not.toBeUndefined();
    const shown = await page.locator('.opt span').allTextContents();
    const idx = shown.indexOf(correct!);
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.locator('.opt').nth(idx).click();
    await expect(page.locator('.opt').nth(idx)).toHaveClass(/correct/);
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
