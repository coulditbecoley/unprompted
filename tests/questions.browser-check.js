// Run against the existing dev server with playwright-cli run-code --filename=tests/questions.browser-check.js.
async page => {
  const base = 'http://127.0.0.1:3218';
  await page.setViewportSize({ width: 390, height: 844 });
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const context = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const evidence = await context.newPage();
    await evidence.goto(base + '/questions');
    const total = await evidence.locator('.q-attempt').count();
    check(total > 0, 'Default summary must contain recorded attempts without JS');
    check(await evidence.locator('.q-answer').count() === 0, 'Default HTML must not embed raw answers');
    const link = evidence.getByRole('link', { name: 'Read full answers to this question' }).first();
    await link.press('Enter');
    const selected = new URL(evidence.url()).searchParams.get('question');
    const block = evidence.locator('.q-block').filter({ has: evidence.getByRole('link', { name: 'Hide full answer text' }) });
    check(Boolean(selected), 'Answer navigation must identify the selected question');
    check(await evidence.locator('.q-attempt').count() === total, 'Loading raw answers must preserve every summary attempt');
    check(await block.locator('.q-answer').count() === await block.locator('.q-attempt').count(), 'Each selected attempt must expose its recorded answer or missing-text notice');
    check(await evidence.locator('.q-answer').count() === await block.locator('.q-answer').count(), 'Other questions must not embed raw answers');
    await block.locator('.q-answer summary').first().press('Enter');
    check(await block.locator('.q-answer').first().getAttribute('open') !== null, 'Answer disclosure must open from keyboard without JS');
    await evidence.getByRole('link', { name: 'Hide full answer text' }).press('Enter');
    check(await evidence.locator('.q-answer').count() === 0, 'Hide link must restore summary-only response');
    const invalid = await evidence.goto(base + '/questions?question=not-a-recorded-question');
    check(invalid.status() === 404 || await evidence.locator('[data-not-found]').count() === 1, 'Unknown question must show not-found');
    await evidence.goto(base + '/questions');
    const reading = await evidence.locator('#evidence-date').inputValue();
    const engine = await evidence.locator('#evidence-engine option').nth(1).getAttribute('value');
    {
      await evidence.goto(base + '/questions?c=ai-coding-assistants&date=' + reading + '&engine=' + engine);
      await evidence.getByRole('link', { name: 'Read full answers to this question' }).first().press('Enter');
      const url = new URL(evidence.url());
      check(url.searchParams.get('date') === reading, 'Full-answer link must preserve the selected reading');
      // Select from the rendered control because the recorded roster can change.
      check(url.searchParams.get('engine') === await evidence.locator('#evidence-engine').inputValue(), 'Full-answer link must preserve the validated engine filter');
    }
  } finally { await context.close(); }
  await page.goto(base + '/categories');
  await page.getByRole('searchbox', { name: 'Search categories' }).fill('no-category-matches-this');
  await page.getByRole('button', { name: 'Clear search' }).press('Enter');
  check(await page.locator('#cat-q').evaluate(el => el === document.activeElement), 'Clear search must return keyboard focus to search');
  await page.goto(base + '/compare');
  check(await page.getByRole('table', { name: 'Brand mentions by question' }).count() === 1, 'Comparison needs table semantics');
  const dot = page.locator('.cmp-history-dot').first();
  await dot.focus();
  check(await dot.evaluate(el => getComputedStyle(el, '::after').content.includes('percent')), 'Focused history point must expose a visible value');
  await page.goto(base + '/consensus');
  const table = page.getByRole('table', { name: 'Assistant picks by question' });
  await table.focus();
  check(await table.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'Scrollable table needs visible focus');
  check(await page.locator('.cns-share[aria-hidden=true]').count() === 0, 'Consensus percentages must be exposed to assistive technology');
  const cellName = await table.locator('.cns-pick').filter({ has: page.locator('.cns-share') }).first().getAttribute('aria-label');
  check(cellName && /: .+, \d+% named first$/.test(cellName), 'Each consensus cell must retain assistant, pick and percentage in its accessible name');
  check(await table.getByRole('cell', { name: cellName, exact: true }).count() > 0, 'Consensus cell name must be exposed through table semantics');
  const before = await table.evaluate(el => el.scrollLeft);
  await table.press('ArrowRight');
  await page.waitForTimeout(250);
  check(await table.evaluate(el => el.scrollLeft) > before, 'Consensus table must scroll using keyboard at mobile width');
  const questionLeft = await table.getByRole('rowheader').first().evaluate(el => el.getBoundingClientRect().left);
  await table.evaluate(el => el.scrollLeft = 400);
  check(Math.abs(await table.getByRole('rowheader').first().evaluate(el => el.getBoundingClientRect().left) - questionLeft) < 2, 'Question must remain visible while scrolling assistant columns');
  await page.goto(base + '/methodology');
  await page.locator('.method-changes summary').press('Enter');
  check(await page.locator('.method-changes').getAttribute('open') !== null, 'Method changes must open from the keyboard');
  const methodTable = page.locator('.method-table').first();
  check(await methodTable.evaluate(el => el.scrollWidth > el.clientWidth), 'Narrow methodology tables must scroll rather than crush column text');
  await page.goto(base + '/categories');
  await page.getByRole('searchbox').fill('unmatched'.repeat(30));
  check(await page.getByRole('button', { name: 'Clear search' }).isVisible(), 'Empty search needs a visible recovery action');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Long empty-state queries must wrap inside the page');
  return 'PASS: no-JS summary/full-answer/hide flow, counts, filters, search focus, table semantics, mobile scrolling and pinned questions, method disclosure, long empty-state query';
}
