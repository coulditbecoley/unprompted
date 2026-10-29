// Native form submission and unresolved consensus picks, using published readings.
// Run: playwright-cli run-code --filename=tests/reading-filters.browser-check.js
async page => {
  const base = 'http://127.0.0.1:3218';
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const context = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const evidence = await context.newPage();
    await evidence.bringToFront();
    await evidence.goto(base + '/questions?question=q01');
    check(await evidence.locator('input[name=question]').inputValue() === 'q01', 'The form must carry the open question');
    await evidence.locator('#evidence-brand').selectOption('Cursor');
    await evidence.getByRole('button', { name: 'Show answers', exact: true }).press('Enter');
    await evidence.waitForURL(url => url.searchParams.get('brand') === 'Cursor' && !url.searchParams.has('filter'));
    check(new URL(evidence.url()).searchParams.get('question') === 'q01', 'Brand filtering must retain the question');
    check(await evidence.locator('#q01 .q-answer').count() > 0, 'Selected answer text must remain loaded without JS');
    check(await evidence.locator('#q01 .q-engine-group:not([open])').count() === 0, 'Selected assistant groups must remain open');
    const assistant = await evidence.locator('#evidence-engine option').nth(1).getAttribute('value');
    await evidence.locator('#evidence-engine').selectOption(assistant);
    await evidence.getByRole('button', { name: 'Show answers', exact: true }).press('Enter');
    await evidence.waitForURL(url => url.searchParams.get('engine') === assistant && !url.searchParams.has('filter'));
    check(new URL(evidence.url()).searchParams.get('question') === 'q01', 'Assistant filtering must retain the question');
    const older = await evidence.locator('#evidence-date option').first().getAttribute('value') || await evidence.locator('#evidence-date option').first().textContent();
    await evidence.locator('#evidence-date').selectOption(older);
    await evidence.getByRole('button', { name: 'Show answers', exact: true }).press('Enter');
    await evidence.waitForURL(url => url.searchParams.get('date') === older && !url.searchParams.has('filter'));
    check(new URL(evidence.url()).searchParams.get('question') === 'q01', 'A question present in the older reading must stay selected');
    // No archive mutation: simulate a carried question missing from the selected reading.
    await evidence.locator('input[name=question]').evaluate(el => el.value = 'q-not-in-reading');
    await evidence.getByRole('button', { name: 'Show answers', exact: true }).press('Enter');
    await evidence.waitForURL(url => !url.searchParams.has('question') && !url.searchParams.has('filter'));
    check(new URL(evidence.url()).searchParams.get('brand') === 'Cursor', 'Dropping a missing question must preserve the brand filter');
    check(new URL(evidence.url()).searchParams.get('date') === older, 'Dropping a missing question must preserve the chosen reading');
    check(await evidence.locator('.q-page h1').isVisible(), 'Missing carried question must recover to answers, not 404');
    check(!(await evidence.locator('link[rel=canonical]').getAttribute('href')).includes('question='), 'Canonical must drop the missing question');
    const invalid = await evidence.goto(base + '/questions?question=q-not-in-reading');
    check(invalid.status() === 404, 'A direct invalid question URL must still return 404');
    let unresolved = 0, firstLink;
    for (const category of ['ai-coding-assistants', 'ai-writing-tools', 'ai-image-generators']) {
      await evidence.goto(base + '/consensus?c=' + category);
      for (const cell of await evidence.locator('.cns-pick').all()) {
        const name = await cell.getAttribute('aria-label');
        if (name.endsWith(': No unique pick')) {
          unresolved++;
          check(await cell.locator('.cns-share, .meter').count() === 0, 'No percentage or bar may imply a unique winner');
          const link = cell.getByRole('link', { name: 'No unique pick', exact: true });
          const href = await link.getAttribute('href');
          const url = new URL(href, base);
          check(url.searchParams.get('c') === category && url.searchParams.get('engine') && url.searchParams.get('date') && url.searchParams.get('question'), 'Unresolved pick needs assistant-specific dated evidence');
          firstLink ??= href;
        } else check(/, \d+% named first$/.test(name), 'Unique picks retain their percentage');
      }
      check(await evidence.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unresolved pick text must fit the phone layout');
    }
    check(unresolved > 0, 'Exercise real unresolved picks');
    await evidence.goto(base + firstLink);
    check(await evidence.locator('.q-answer').count() > 0, 'Unresolved pick must lead to loaded original answers without JS');
    return { result: 'PASS', olderReading: older, unresolvedCells: unresolved, noJavaScript: true };
  } finally { await context.close(); }
}
