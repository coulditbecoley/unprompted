// Run with playwright-cli run-code --filename=tests/brand-highlight.browser-check.js.
async page => {
 const base = 'http://127.0.0.1:3218';
 const check = (ok, message) => { if (!ok) throw new Error(message); };
 const results = [];
 await page.goto(base + '/questions?brand=Cursor&question=q01');
 const filtered = await page.locator('.q-answer > p:first-of-type').allTextContents();
 const marks = await page.locator('.q-brand-highlight').allTextContents();
 check(marks.length > 0 && marks.every(text => /^cursor$/i.test(text)), 'Wrong or absent highlights');
 await page.goto(base + '/questions?question=q01');
 const unfiltered = await page.locator('.q-answer > p:first-of-type').allTextContents();
 check(filtered.every(text => unfiltered.includes(text)), 'Highlighting changed the answer text');
 check(await page.locator('mark').count() === 0, 'Unfiltered answers must not be highlighted');
 await page.goto(base + '/questions?brand=Cursor');
 check(await page.locator('.q-answer, .q-brand-highlight').count() === 0, 'Summary view must not load raw answers');
 await page.goto(base + '/questions?brand=Cursor&question=q01');
 await page.locator('.q-answer > summary').first().click();
 for (const width of [390, 1440]) {
  await page.setViewportSize({width, height: 900});
  for (const theme of ['light', 'dark']) {
   await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
   await page.locator('.q-answer[open]').first().scrollIntoViewIfNeeded();
   const colors = await page.locator('.q-brand-highlight').first().evaluate(el => {
    const s = getComputedStyle(el), root = getComputedStyle(document.documentElement);
    return { background: s.backgroundColor, color: s.color, cell: root.getPropertyValue('--cell-1').trim() };
   });
   check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
   await page.screenshot({path: `.playwright-cli/codex-r17-${width}-${theme}.png`});
   results.push({width, theme, ...colors});
  }
 }
 await page.emulateMedia({forcedColors: 'active', reducedMotion: 'reduce'});
 check(await page.locator('.q-brand-highlight').first().evaluate(el => getComputedStyle(el).textDecorationLine.includes('underline')), 'Forced colours must keep a non-colour highlight');
 await page.emulateMedia({forcedColors: 'none', media: 'print'});
 check(await page.locator('.q-brand-highlight').first().evaluate(el => getComputedStyle(el).textDecorationLine.includes('underline')), 'Print must preserve the highlight without backgrounds');
 await page.emulateMedia({media: 'screen', reducedMotion: 'no-preference'});
 const context = await page.context().browser().newContext({javaScriptEnabled: false});
 try {
  const nojs = await context.newPage();
  await nojs.goto(base + '/questions?brand=Cursor&question=q01');
  await nojs.locator('.q-answer > summary').first().focus();
  await nojs.keyboard.press('Enter');
  check(await nojs.locator('.q-answer[open] .q-brand-highlight').count() > 0, 'No-JS keyboard opening must show highlights');
 } finally { await context.close(); }
 return {marks: marks.length, checks: results, plainTextPreserved: true, noJs: true, forcedColors: true, print: true};
}
