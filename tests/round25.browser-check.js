// Run with playwright-cli run-code --filename=tests/round25.browser-check.js.
async page=>{
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);},out=[];
 for(const width of [390,768,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:3218/methodology');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  check((await page.locator('.method-flow h3').allTextContents()).join(',')==='Ask,Repeat,Read,Check,Publish','Wrong pipeline steps');
  check(await page.locator('.method-arrow[aria-hidden=true]').count()===4,'Four decorative arrows required');
  check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Diagram overflow');
  await page.locator('.method-flow').screenshot({path:`.playwright-cli/codex-r25-pipeline-${width}-${theme}.png`});
  await page.emulateMedia({forcedColors:'active'});
  check(await page.locator('.method-flow li').count()===5,'Forced colours lose steps');
  await page.emulateMedia({forcedColors:'none',media:'print'});
  check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Print overflow');await page.emulateMedia({media:'screen'});
  await page.goto('http://127.0.0.1:3218/questions');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  check(await page.locator('.q-first-pick').count()===15,'Every question needs a summary');
  check((await page.locator('#q01 .q-first-pick').textContent()).includes('30 answers'),'All assistants denominator must be 30');
  await page.locator('#q01').screenshot({path:`.playwright-cli/codex-r25-question-${width}-${theme}.png`});
  check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Question overflow');
  out.push({width,theme,result:'PASS'});
 }
 const context=await page.context().browser().newContext({javaScriptEnabled:false});
 try{
  const p=await context.newPage();await p.goto('http://127.0.0.1:3218/methodology');check(await p.locator('.method-flow li').count()===5,'No-JS diagram missing');
  for(const query of ['engine=chatgpt','brand=Cursor','brand=Playcode+AI&question=q01','date=2026-08-22']){
   await p.goto('http://127.0.0.1:3218/questions?'+query);
   const summaries=await p.locator('.q-first-pick').allTextContents();check(summaries.length>0,'No-JS summaries missing '+query);
   if(query.startsWith('engine='))check(summaries.every(t=>/5 answers/.test(t)),'Assistant filter denominator wrong');
   if(query.startsWith('brand=Playcode'))check(summaries[0].startsWith('No answers'),'Zero-answer summary wrong');
   out.push({query,first:summaries[0]});
  }
 }finally{await context.close();}
 return out;
}
