// Run with playwright-cli run-code --filename=tests/newcomer-round18.browser-check.js.
async page => {
 const base='http://127.0.0.1:3218';
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 const results=[];
 for(const width of [390,1440]) for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  for(const name of ['categories','compare','consensus','questions','methodology','missing-r18']) {
   const response=await page.goto(base+'/'+name);
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   check(response.status()===(name==='missing-r18'?404:200),'Wrong status '+name);
   check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Overflow '+name);
   await page.screenshot({path:`.playwright-cli/codex-r18-top-${name}-${width}-${theme}.png`});
   if(name==='categories') {
    await page.getByRole('searchbox',{name:'Search categories or brands',exact:true}).fill('no-such-brand-r18');
    check(await page.locator('.cat-card').count()===0,'Empty search must be clear');
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    check(await page.locator('.cat-card').count()===3 && await page.locator('#cat-q').evaluate(el=>el===document.activeElement),'Clear must restore cards and focus');
   }
   if(name==='compare') {
    const links=page.locator('.h2h-q a');
    const hrefs=await links.evaluateAll(nodes=>nodes.map(n=>n.href));
    check(hrefs.length===15,'Every question needs an evidence link');
    for(const href of hrefs) {
     const url=new URL(href);
     check(url.pathname==='/questions' && url.searchParams.get('c')==='ai-coding-assistants' && url.searchParams.has('date') && url.hash==='#'+url.searchParams.get('question') && !url.searchParams.has('brand'),'Evidence must preserve the question and reading for both brands');
    }
    await links.last().scrollIntoViewIfNeeded();
    await page.screenshot({path:`.playwright-cli/codex-r18-compare-links-${width}-${theme}.png`});
    const target=new URL(hrefs.at(-1));
    await links.last().focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(target.href);
    check(await page.locator(target.hash+' .q-answer').count()>0,'Question link must load raw evidence');
    check(await page.locator('#evidence-date').inputValue()===target.searchParams.get('date'),'Evidence reading drifted');
   }
   results.push({name,width,theme});
  }
 }
 const context=await page.context().browser().newContext({javaScriptEnabled:false});
 try {
  const p=await context.newPage();
  await p.goto(base+'/compare?c=ai-writing-tools');
  const link=p.locator('.h2h-q a').first();
  const href=await link.getAttribute('href');
  check(new URL(href,base).searchParams.get('c')==='ai-writing-tools','Alternate category drifted');
  await link.focus();await p.keyboard.press('Enter');await p.waitForURL(base+href);
  check(await p.locator('#q01 .q-answer').count()>0,'No-JS evidence navigation failed');
 } finally {await context.close();}
 return {passed:results.length,cases:results,noJs:'PASS'};
}
