async page => {
 const base='http://127.0.0.1:3218',out=[];
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 async function tabTo(p,selector){
  for(let i=0;i<150;i++){
   await p.keyboard.press('Tab');
   if(await p.evaluate(s=>document.activeElement?.matches(s),selector))return;
  }
  throw new Error('Keyboard cannot reach '+selector+' at '+p.url());
 }
 for(const width of [390,768,1440]) for(const theme of ['light','dark']){
  const context=await page.context().browser().newContext({javaScriptEnabled:false,viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
  try{
   const p=await context.newPage();await p.bringToFront();
   for(const route of ['/compare','/consensus','/questions','/methodology','/categories','/missing-r14']){
    const response=await p.goto(base+route);
    await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    check(response.status()===(route.includes('missing')?404:200),'No-JS status');
    check(await p.locator('main h1').isVisible(),'No-JS heading missing');
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No-JS overflow '+route);
    if(route==='/compare'){
     await tabTo(p,'#cmp-a');await p.keyboard.press('Home');await p.keyboard.press('ArrowDown');
     const selected=await p.locator('#cmp-a').inputValue();
     await tabTo(p,'.cmp-form button');await p.keyboard.press('Enter');
     await p.waitForURL(u=>u.searchParams.get('a')===selected);
    }
    if(route==='/consensus'){
     await tabTo(p,'.cns-q a');await p.keyboard.press('Enter');await p.waitForURL(u=>u.pathname==='/questions');
     check(await p.locator('.q-answer').count()>0,'No-JS consensus must load answers');
    }
    if(route==='/questions'){
     await tabTo(p,'.q-load-answers a');await p.keyboard.press('Enter');await p.waitForURL(u=>u.searchParams.has('question'));
     await tabTo(p,'.q-answer summary');await p.keyboard.press('Enter');
     check(await p.locator('.q-answer[open]').count()>0,'Keyboard opens raw answer');
    }
    if(route==='/methodology'){
     await tabTo(p,'.method-changes summary');await p.keyboard.press('Enter');
     check(await p.locator('.method-changes[open]').count()===1,'No-JS version notes');
    }
    if(route==='/categories'){
     check(await p.locator('.cat-search').getAttribute('method')==='get','No-JS category search must submit a GET form');
     await tabTo(p,'a.cat-card');await p.keyboard.press('Enter');await p.waitForURL(u=>u.pathname.startsWith('/chart/'));
    }
    if(route.includes('missing')){
     await tabTo(p,'[data-not-found] a[href="/categories"]');await p.keyboard.press('Enter');await p.waitForURL(u=>u.pathname==='/categories');
    }
   }
   await p.goto(base+'/');
   check(!await p.locator('.contact-form').isVisible(),'No-JS contact must not submit personal fields through URL');
   check(await p.locator('.contact-polished noscript a').isVisible(),'No-JS contact needs recovery link');
   check(await p.locator('.contact-form').getAttribute('method')==='post','POST protects pre-hydration fallback');
   out.push({width,theme,keyboard:'PASS',noJavaScript:'PASS',contactFallback:'PASS'});
  }finally{await context.close();}
 }
 return {result:'PASS',cases:out};
}
