// Run with playwright-cli run-code --filename=tests/category-query.browser-check.js.
async page => {
 const base='http://127.0.0.1:3218';
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const out=[];
 for(const javaScriptEnabled of [false,true])for(const width of [390,1440])for(const theme of ['light','dark']) {
  const context=await page.context().browser().newContext({javaScriptEnabled,viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
  try {
   const p=await context.newPage();
   for(const [q,expected] of [['Cursor',1],['CodeRabbit',1],['writing',1],['  ',3],['no-such-brand-r21',0],['<b>unknown-term</b>',0],['x'.repeat(400),0]]) {
    const response=await p.goto(base+'/categories?'+new URLSearchParams({q}));
    check(response.status()===200,'Query must render: '+q);
    await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    check(await p.locator('#cat-q').inputValue()===q,'Query not prefilled');
    check(await p.locator('.cat-card').count()===expected,'Wrong filtered population: '+q);
    check(await p.locator('.cat-empty b').count()===0,'Query became markup');
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Query overflow: '+q);
    if(expected===0)check((await p.locator('.cat-empty').textContent()).includes(q),'Missing unmatched term');
   }
   await p.goto(base+'/categories?q=Cursor');
   await p.locator('#cat-q').fill('writing');
   if(javaScriptEnabled)check((await p.locator('.cat-card h3').allTextContents()).join()==='AI Writing Tools','Live search did not start from query');
   await p.locator('#cat-q').press('Enter');
   await p.waitForURL('**/categories?q=writing');
   check((await p.locator('.cat-card h3').allTextContents()).join()==='AI Writing Tools','GET form failed');
   await p.getByRole('link',{name:'Show all categories',exact:true}).press('Enter');
   await p.waitForURL('**/categories');
   check(await p.locator('.cat-card').count()===3,'Clear link must restore all categories');
   await p.goto(base+'/categories?q=no-such-brand-r21');
   await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   if(javaScriptEnabled) {
    await p.screenshot({path:`.playwright-cli/codex-r21-${width}-${theme}.png`});
    await p.getByRole('button',{name:'Clear search',exact:true}).click();
    check(await p.locator('.cat-card').count()===3 && await p.locator('#cat-q').evaluate(el=>el===document.activeElement),'Live clear/focus failed');
    check(!new URL(p.url()).searchParams.has('q'),'Clear must remove the persisted search');
    await p.reload();
    check(await p.locator('.cat-card').count()===3 && await p.locator('#cat-q').inputValue()==='', 'Refresh must keep the search cleared');
   } else check(!await p.getByRole('button',{name:'Clear search',exact:true}).isVisible(),'No-JS clear must not be an inert button');
   out.push({javaScriptEnabled,width,theme,result:'PASS'});
  } finally {await context.close();}
 }
 return out;
}
