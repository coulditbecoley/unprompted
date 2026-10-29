// Run via playwright-cli run-code --filename=tests/search.browser-check.js against the existing dev server.
async page => {
 const check = (ok, message) => { if (!ok) throw new Error(message); };
 const base = 'http://127.0.0.1:3218';
 const routes = [
  '/compare', '/compare?a=cursor&b=cursor', '/compare?c=ai-writing-tools&a=grammarly&b=claude',
  '/consensus', '/consensus?c=ai-image-generators',
  '/questions', '/questions?brand=Cursor&question=q01',
  '/categories', '/methodology'
 ];
 const results=[];
 for(const route of routes) {
  await page.goto(base+route);
  const metadata = await page.evaluate(()=>({
   title: document.title,
   description: document.querySelector('meta[name=description]')?.content,
   canonical: document.querySelector('link[rel=canonical]')?.href,
   ogUrl: document.querySelector('meta[property="og:url"]')?.content,
   ogTitle: document.querySelector('meta[property="og:title"]')?.content,
   ogDescription: document.querySelector('meta[property="og:description"]')?.content,
  }));
  check(metadata.title && metadata.description && metadata.ogTitle && metadata.ogDescription, 'Missing metadata: '+route);
  check(metadata.canonical?.startsWith('https://unprompted.report'+route.split('?')[0]), 'Canonical must identify this page: '+route);
  check(metadata.ogUrl === metadata.canonical, 'OG URL must match canonical: '+route);
  if(route.startsWith('/compare')) {
   const a=await page.locator('#cmp-a').inputValue(), b=await page.locator('#cmp-b').inputValue();
   const url = new URL(metadata.canonical);
   check(url.searchParams.get('a')===a && url.searchParams.get('b')===b, 'Canonical must preserve actual pair');
   const shares=await page.locator('.cmp-big').allTextContents();
   check(shares.every(share=>metadata.description.includes(share)), 'Description must use displayed first-pick shares');
   const dots = await page.locator('.cmp-history-dot').count();
   const labels = await page.locator('.cmp-history-value').count();
   if(dots && dots<=16) {
    check(labels===dots, 'Sparse history needs every value labelled');
    const collisions = await page.evaluate(() => {
     const values=[...document.querySelectorAll('.cmp-history-value')].map(n=>n.getBoundingClientRect());
     const points=[...document.querySelectorAll('.cmp-history-dot')].map(n=>n.getBoundingClientRect());
     return values.some(a=>points.some(b=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top));
    });
    check(!collisions, 'Percentage labels must not cross plotted points');
   }
  }
  if(route.startsWith('/consensus')) {
   const finding=(await page.locator('h1').textContent()).match(/\d+ of \d+/)?.[0];
   check(finding && metadata.description.includes(finding), 'Consensus description must match visible finding');
  }
  if(route.includes('brand=Cursor')) {
   check(new URL(metadata.canonical).searchParams.get('brand')==='Cursor' && new URL(metadata.canonical).searchParams.get('question')==='q01', 'Evidence canonical must preserve filters and question');
   check(metadata.description.startsWith(String(await page.locator('.q-attempt').count())+' answers'), 'Evidence description must match filtered count');
  }
  if(!route.startsWith('/methodology')) {
   const copy = await page.locator('main').innerText();
   check(!/\b(rotation|usable answers|median position|engines?)\b/i.test(copy), 'Visible jargon remains: '+route);
  }
  results.push({route,...metadata});
 }
 for(const route of ['/not-a-real-page-r4','/questions?brand=not-a-brand','/questions?date=1900-01-01']) {
  const response=await page.goto(base+route);
  check(response.status()===404, 'Missing evidence must be 404');
  check(await page.locator('meta[name=robots][content*=noindex]').count()>0, '404 must be noindex');
 }
 return {result:'PASS',pages:results};
}
