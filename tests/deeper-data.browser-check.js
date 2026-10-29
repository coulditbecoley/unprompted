// Compare rendered assistant counts against the recorded evidence, not a copy of the aggregation formula.
// Run via playwright-cli run-code --filename=tests/deeper-data.browser-check.js.
async page => {
 const base='http://127.0.0.1:3218';
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const context=await page.context().browser().newContext({javaScriptEnabled:false,viewport:{width:390,height:900},reducedMotion:'reduce'});
 const e=await context.newPage();
 const routes=['/compare','/compare?a=aider&b=cursor','/compare?a=cline&b=playcode-ai','/compare?a=cursor&b=cursor','/compare?c=ai-writing-tools','/compare?c=ai-image-generators'];
 const results=[];
 try {
  for(const route of routes) {
   await e.goto(base+route);
   const headers=await e.locator('.cmp-assistants thead th').allTextContents();
   const table=await e.locator('.cmp-assistants tbody tr').evaluateAll(nodes=>nodes.map(n=>({engine:n.dataset.engine,label:n.querySelector('th').textContent,counts:[...n.querySelectorAll('.cmp-assistant-count')].map(c=>c.textContent.match(/^(\d+)\/(\d+)/).slice(1).map(Number)),shares:[...n.querySelectorAll('.cmp-assistant-share')].map(c=>parseInt(c.textContent))})));
   const verdict=await e.locator('.cmp-verdict').innerText();
   if(route==='/compare') check(verdict.includes('does not establish a clear first-pick lead'),'Current 153 vs 135 out of 450 must not imply a clear lead');
   if(route.includes('a=aider&b=cursor')) check(verdict.includes('Cursor has a clear first-pick lead'),'Reversed pair must use the larger count first');
   if(route.includes('a=cline&b=playcode')) check(verdict.includes('Neither has a first-pick lead'),'Equal zero first picks must not imply a winner');
   if(route.includes('a=cursor&b=cursor')) check(verdict.includes('Both selections show Cursor'),'Identical brands are not independent choices');
   check(await e.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Assistant table must fit phone width');
   await e.getByRole('link',{name:'Read the recorded answers',exact:true}).press('Enter');
   const expected=await e.locator('.q-engine-group').evaluateAll((groups,brands)=>{
    const out={};
    for(const g of groups){
     const label=g.querySelector('summary').firstChild.textContent.trim();
     out[label]??={of:0,named:[0,0]};
     for(const a of g.querySelectorAll('.q-attempt')){
      if(/^(Could not use this answer:|Declined to recommend a brand)/.test(a.querySelector('em')?.textContent ?? ''))continue;
      out[label].of++;
      const names=a.textContent.trim().split(' · ');
      brands.forEach((b,i)=>{if(names.includes(b))out[label].named[i]++;});
     }
    }
    return out;
   },headers.slice(1));
   for(const row of table){
    const x=expected[row.label];
    check(x && row.counts.every((counts,i)=>counts[0]===x.named[i] && counts[1]===x.of),'Assistant counts must match evidence: '+route+' '+row.label);
    check(row.shares.every((value,i)=>value===Math.round(x.named[i]/x.of*100)),'Percentages must use assistant answers');
   }
   results.push({route,assistants:table.length,verdict});
  }
  for(const category of ['ai-coding-assistants','ai-writing-tools','ai-image-generators']){
   await e.goto(base+'/consensus?c='+category);
   const links=await e.locator('.cns-q a').evaluateAll(nodes=>nodes.map(n=>({href:n.href,text:n.textContent})));
   check(links.length===await e.locator('.cns-row[role=row]').count()-1,'Every consensus question needs a link');
   for(const link of links){const url=new URL(link.href);check(url.searchParams.get('c')===category&&url.searchParams.has('date')&&url.hash==='#'+url.searchParams.get('question'),'Question links must pin category, reading and anchor');}
   await e.locator('.cns-q a').first().press('Enter');
   const q=new URL(e.url()).searchParams.get('question');
   check((await e.locator('#'+q+' h2').innerText()).includes(links[0].text),'Evidence must show the same frozen question');
   check(await e.locator('#'+q+' .q-answer').count()>0,'Question link must load actual answer text without JS');
  }
  return {result:'PASS',results,consensusCategories:3};
 } finally {await context.close();}
}
