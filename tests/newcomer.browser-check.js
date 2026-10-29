// Run with playwright-cli run-code --filename=tests/newcomer.browser-check.js.
async page => {
 const base='http://127.0.0.1:3218';
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const results=[];
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base+'/categories');
  for(const brand of ['CodeRabbit','Playcode AI']) {
   await page.getByRole('searchbox').fill(brand);
   check(await page.locator('.cat-card').count()===1,'Archived brand search must find its category: '+brand);
   check((await page.locator('.cat-card').getAttribute('href'))==='/chart/ai-coding-assistants','Brand search must return the right board');
  }
  await page.locator('.cat-card').click();
  await page.waitForURL('**/chart/ai-coding-assistants');
  check(new URL(page.url()).pathname==='/chart/ai-coding-assistants','Category search must reach published results');
  await page.goto(base+'/compare');
  const evidence=page.getByRole('link',{name:'Read the recorded answers',exact:true});
  const evidenceUrl=new URL(await evidence.getAttribute('href'),base);
  check(evidenceUrl.searchParams.has('date'),'Comparison evidence must pin the reading');
  await evidence.click();
  await page.waitForURL(url=>url.pathname==='/questions');
  check(await page.locator('#evidence-date').inputValue()===evidenceUrl.searchParams.get('date'),'Evidence must match comparison reading');
  await page.getByRole('link',{name:'Jump to questions',exact:true}).click();
  check(new URL(page.url()).hash==='#question-list','Jump must reach question index');
  await page.getByRole('link',{name:'How the answers are counted',exact:true}).click();
  await page.waitForURL('**/methodology#glossary');
  check(new URL(page.url()).hash==='#glossary' && await page.locator('#glossary').count()===1,'Evidence must reach counting definitions');
  await page.getByRole('link',{name:'Explore published results',exact:true}).click();
  await page.waitForURL('**/categories');
  check(new URL(page.url()).pathname==='/categories','Method must provide a route back to results');
  const context=await page.context().browser().newContext({javaScriptEnabled:false,viewport:{width,height:900},reducedMotion:'reduce'});
  try {
   const e=await context.newPage();
   await e.goto(base+'/questions');
   const date=await e.locator('#evidence-date').inputValue();
   const engine=await e.locator('#evidence-engine option').nth(1).getAttribute('value');
   const original=base+'/questions?'+new URLSearchParams({c:'ai-coding-assistants',date,engine,brand:'Cursor',question:'q01'});
   for(const [name,removed,retained,value] of [['Show all brands','brand','engine',engine],['Show all assistants','engine','brand','Cursor']]) {
    await e.goto(original);
    check(await e.locator('#q01 .q-answer').count()>0,'Selected question must initially have loaded evidence');
    await e.getByRole('link',{name,exact:true}).press('Enter');
    const url=new URL(e.url());
    check(!url.searchParams.has(removed) && url.searchParams.get(retained)===value,'Clear only the requested filter');
    check(url.searchParams.get('question')==='q01' && url.searchParams.get('date')===date && url.hash==='#q01','Clearing filter must retain question, reading and anchor');
    check(await e.locator('#q01 .q-answer').count()>0,'Clearing filter must keep selected question evidence loaded');
    check(await e.locator('#q01 .q-engine-group:not([open])').count()===0,'Selected question assistant groups must stay open');
   }
   await e.getByRole('link',{name:"View this reading's chart",exact:true}).press('Enter');
   check(new URL(e.url()).pathname==='/chart/ai-coding-assistants/'+date,'Evidence must return to the exact chart');
   results.push({width,brandSearch:'PASS',journey:'PASS',clearFiltersWithoutJS:'PASS'});
  } finally {await context.close();}
 }
 return {result:'PASS',results};
}
