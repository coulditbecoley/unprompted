// Run with playwright-cli in a WebKit or Firefox session against the existing dev server.
async page => {
  const base = 'http://127.0.0.1:3218';
  const browser = page.context().browser().browserType().name();
  const errors = [], results = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const route of ['/compare', '/consensus', '/questions', '/questions?question=q01&brand=Cursor', '/methodology', '/categories', '/missing-round28']) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await page.locator('main h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      check(response.status() === (route.includes('missing') ? 404 : 200), 'HTTP status: ' + route);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflow: ' + route + ' ' + width);
      if (route.startsWith('/consensus') && width === 390) {
        const table = page.locator('.cns.panel');
        const before = await page.locator('.cns-q').first().boundingBox();
        await table.evaluate(el => el.scrollLeft = 240);
        const after = await page.locator('.cns-q').first().boundingBox();
        check(Math.abs(before.x - after.x) < 2, 'Question column did not stay in view');
        await table.evaluate(el => el.scrollLeft = 0);
      }
      if (route.includes('question=q01')) {
        const detail = page.locator('.q-answer').first();
        const summary = detail.locator('summary');
        await summary.focus(); await page.keyboard.press('Enter');
        check(await detail.evaluate(el => el.open), 'Keyboard did not open answer');
        check(await detail.locator('p').first().isVisible(), 'Opened answer invisible');
        check(await page.locator('.q-brand-highlight').count() > 0, 'Brand highlights missing');
        await page.keyboard.press('Enter');
        check(!await detail.evaluate(el => el.open), 'Keyboard did not close answer');
      }
      if (route === '/methodology') {
        const detail = page.locator('.method-changes');
        await detail.locator('summary').focus(); await page.keyboard.press('Enter');
        check(await detail.locator('.prose').isVisible(), 'Version notes invisible');
        check(await page.locator('.method-flow li').count() === 5, 'Pipeline missing steps');
      }
      await page.screenshot({ path: `.playwright-cli/codex-r28-${browser}-${width}-${theme}-${route.includes('?') ? 'loaded-answers' : route.slice(1)}.png`, fullPage: true, caret: 'initial' });
      results.push({ route, width, theme });
    }
  }
  await page.goto(base + '/categories', { waitUntil: 'networkidle' });
  await page.locator('#cat-q').fill('no-such-brand-round28');
  await page.locator('.cat-empty').waitFor();
  check(await page.locator('.cat-empty').isVisible(), 'Live search empty state missing');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  check(await page.locator('#cat-q').inputValue() === '', 'Search did not clear');
  await page.locator('#cat-q').fill('Cursor');
  await page.getByRole('button', { name: 'Search categories', exact: true }).click();
  await page.waitForURL('**/categories?q=Cursor');
  check(await page.locator('.cat-card').count() > 0, 'Submitted category search lost results');
  await page.goto(base + '/compare', { waitUntil: 'networkidle' });
  await page.locator('#cmp-a').selectOption('cursor');
  await page.locator('#cmp-b').selectOption('cursor');
  await page.getByRole('button', { name: 'Compare brands', exact: true }).click();
  await page.waitForURL('**/compare?**a=cursor&b=cursor');
  check((await page.locator('.cmp-verdict').innerText()).includes('Both selections'), 'Compare form lost selections');
  await page.goto(base + '/questions?question=q01', { waitUntil: 'networkidle' });
  await page.locator('#evidence-engine').selectOption('chatgpt');
  await page.getByRole('button', { name: 'Show answers', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('engine') === 'chatgpt' && !url.searchParams.has('filter'));
  check(await page.locator('#q01 .q-attempt').count() === 5, 'Question form lost assistant filter');
  check(errors.length === 0, 'Browser errors: ' + JSON.stringify([...new Set(errors)]));
  return { result: 'PASS', browser, layoutCases: results.length, forms: 3, consoleErrors: errors.length };
}
