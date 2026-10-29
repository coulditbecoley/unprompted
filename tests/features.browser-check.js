// Real archive and rendered chart parity, without JavaScript. Run via playwright-cli run-code --filename=tests/features.browser-check.js.
async page => {
  const base = 'http://127.0.0.1:3218';
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const context = await page.context().browser().newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const evidence = await context.newPage();
    await evidence.goto(base + '/questions');
    const date = await evidence.locator('#evidence-date').inputValue();
    const category = await evidence.locator('input[name=c]').inputValue();
    const brands = await evidence.locator('#evidence-brand option').evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean));
    const attempts = await evidence.locator('.q-attempt').evaluateAll(nodes => nodes.filter(n => !n.querySelector('em')).map(n => n.textContent.trim().split(' · ')));
    const firstEngine = await evidence.locator('#evidence-engine option').nth(1).getAttribute('value');
    await evidence.goto(base + '/questions?' + new URLSearchParams({ c: category, date, engine: firstEngine }));
    const engineNames = await evidence.locator('.q-attempt').evaluateAll(nodes => nodes.filter(n => !n.querySelector('em')).flatMap(n => n.textContent.trim().split(' ? ')));
    const absent = brands.find(b => !engineNames.includes(b));
    check(absent, 'Archive must supply a real empty filter combination');
    await evidence.goto(base + '/questions?' + new URLSearchParams({ c: category, date, engine: firstEngine, brand: absent }));
    check(await evidence.locator('.q-attempt').count() === 0 && await evidence.locator('.q-empty').count() === 1, 'Known brand with no matching answers needs explicit empty state');
    const brand = brands.find(b => attempts.some(names => names.includes(b)));
    check(brand, 'Archive must supply a brand for parity checks');
    const expected = attempts.filter(names => names.includes(brand)).length;
    const query = new URLSearchParams({ c: category, date, brand });
    await evidence.goto(base + '/questions?' + query);
    check(await evidence.locator('.q-attempt').count() === expected, 'Brand filter must count each usable answer once');
    check(await evidence.locator('.q-answer').count() === 0, 'Filter must keep raw text lazy');
    check((await evidence.locator('.q-filter-result').textContent()).includes(String(expected)), 'Displayed filtered count must match answers');
    await evidence.getByRole('link', { name: 'Read full answers to this question' }).first().press('Enter');
    check(new URL(evidence.url()).searchParams.get('brand') === brand, 'Full-answer link must preserve brand');
    check(await evidence.locator('.q-attempt').count() === expected, 'Full text must preserve filtered population');
    await evidence.getByRole('link', { name: 'Hide full answer text' }).press('Enter');
    check(new URL(evidence.url()).searchParams.get('brand') === brand, 'Hide must preserve brand');
    const engine = await evidence.locator('#evidence-engine option').nth(1).getAttribute('value');
    await evidence.locator('#evidence-engine').selectOption(engine);
    await evidence.getByRole('button', { name: 'Show answers' }).press('Enter');
    check(new URL(evidence.url()).searchParams.get('brand') === brand, 'Form must preserve brand without JS');
    const clearEngine = evidence.getByRole('link', { name: 'Show all assistants' });
    check(new URL(await clearEngine.getAttribute('href'), base).searchParams.get('brand') === brand, 'Clearing assistant must preserve brand');
    await evidence.getByRole('link', { name: 'Show all brands' }).press('Enter');
    check(new URL(evidence.url()).searchParams.get('engine') === engine, 'Clearing brand must preserve assistant');
    const invalid = await evidence.goto(base + '/questions?brand=not-an-archived-brand');
    check(invalid.status() === 404, 'Unknown brand must not silently show unfiltered answers');
    await evidence.goto(base + '/compare?' + new URLSearchParams({ c: category, a: brand }));
    const mention = await evidence.locator('.cmp-cards .cmp-pick').first().locator('.cmp-stat').first().textContent();
    check(Number(mention.match(/(\d+)\//)[1]) === expected, 'Filtered answers must match Compare mention count');
    const presets = await evidence.locator('.cmp-presets a').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, href: n.href })));
    check(presets.length > 0, 'Published boards need real comparison presets');
    for (const preset of presets) {
      const url = new URL(preset.href);
      check(url.searchParams.get('a') && url.searchParams.get('b') && url.searchParams.get('a') !== url.searchParams.get('b'), 'Preset needs two distinct shareable brands');
      await evidence.goto(preset.href);
      check(await evidence.locator('.cmp-cards .cmp-pick').count() === 2, 'Preset must resolve to two brand cards');
      if (preset.text.endsWith(': top two')) {
        await evidence.goto(base + '/compare?c=' + url.searchParams.get('c'));
        const selected = await evidence.locator('.cmp-title').textContent();
        await evidence.goto(preset.href);
        check(await evidence.locator('.cmp-title').textContent() === selected, 'Top-two preset must match the board leaders');
      }
    }
    await evidence.goto(base + '/categories');
    const agreements = await evidence.locator('.cat-card[data-live=true]').evaluateAll(nodes => nodes.map(n => ({ category: n.getAttribute('href').split('/').pop(), text: n.querySelector('.cat-agreement').textContent })));
    for (const item of agreements) {
      await evidence.goto(base + '/consensus?c=' + item.category);
      const numbers = item.text.match(/(\d+) of (\d+)/);
      if (numbers) check((await evidence.locator('h1').textContent()).replace(/\s+/g, ' ').includes(`${numbers[1]} of ${numbers[2]}`), 'Category agreement must match Consensus');
    }
    await evidence.goto(base + '/methodology#glossary');
    check(await evidence.locator('.method-glossary dt').count() === 5, 'Glossary must define all five terms');
    return { result: 'PASS', brand, expected, presets: presets.length, agreements: agreements.length };
  } finally { await context.close(); }
}
