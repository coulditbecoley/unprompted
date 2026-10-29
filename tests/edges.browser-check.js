async page => {
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 const base='http://127.0.0.1:3218';
 const routes=['/compare','/consensus','/questions','/questions?date=2026-08-22&question=q01','/questions?brand=Playcode+AI&question=q01','/methodology','/categories','/missing-r5'];
 const results=[];
 for(const theme of ['light','dark']) {
  await page.setViewportSize({width:794,height:1000});
  for(const route of routes) {
   await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce',media:'screen'});
   const response=await page.goto(base+route);
   await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
   const scope=page.locator('main > section');
   const forced=await scope.evaluate(n=>({
    animations:n.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,
    agreed:[...n.querySelectorAll('.cns-strip > span')].map(e=>({agreed:e.dataset.agreed,background:getComputedStyle(e).backgroundColor})),
    dots:[...n.querySelectorAll('.cmp-history-dot')].map(e=>({square:e.classList.contains('is-b'),background:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderColor})),
    overflow:document.documentElement.scrollWidth>innerWidth
   }));
   check(forced.animations===0,'Reduced motion must not defer visible content: '+route);
   check(!forced.overflow,'Screen overflow: '+route);
   if(forced.agreed.length) check(forced.agreed.find(e=>e.agreed==='true').background!==forced.agreed.find(e=>e.agreed==='false').background,'Forced colours must preserve agreement');
   if(forced.dots.length) check(forced.dots.find(e=>e.square).background!==forced.dots.find(e=>!e.square).background,'Forced colours must preserve filled/open dots');
   if(route.includes('Playcode')) {
    check(await page.locator('.q-attempt').count()===0,'Absent brand must not show unrelated answers');
    check(await page.locator('#q01').count()===1,'Zero-match question deep link must still have a target');
    check((await page.locator('#q01').innerText()).includes('No answers to this question name Playcode AI'),'Zero-match question needs an explicit explanation');
   }
   if(route.includes('2026-08-22')) {
    check(await page.locator('#evidence-date').inputValue()==='2026-08-22','Old reading must stay selected');
    check(await page.locator('.q-answer').count()>0,'Old reading must expose selected question evidence');
    check((await page.locator('link[rel=canonical]').getAttribute('href')).includes('date=2026-08-22'),'Old reading canonical must preserve date');
   }
   if(route.includes('missing')) {
    check(response.status()===404,'Missing route must be 404');
    check(await page.locator('meta[name=robots][content*=noindex]').count()>0,'Missing route must be noindex');
   }
   await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce',media:'print'});
   await page.waitForTimeout(100);
   const print=await scope.evaluate(n=>({width:innerWidth,scroll:document.documentElement.scrollWidth,color:getComputedStyle(n.querySelector('h1')).color,clipped:[...n.querySelectorAll('.cns.panel,.method-table,.cmp-chart-scroll')].some(e=>e.scrollWidth>e.clientWidth+1)}));
   check(print.scroll<=print.width && !print.clipped,'Print must not clip data columns: '+route);
   check(print.color==='rgb(0, 0, 0)','Print must use legible text in either theme: '+route);
   if(route.startsWith('/questions')) {
    const hidden=await page.locator('.q-attempt').evaluateAll(nodes=>nodes.some(n=>!n.checkVisibility({contentVisibilityAuto:true})));
    check(!hidden,'Print must include summaries inside closed evidence disclosures');
   }
   results.push({route,theme,status:response.status(),forced,print});
  }
 }
 await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce',media:'screen'});
 for(const route of ['/questions?question=not-a-question','/questions?brand=not-a-brand','/questions?date=1900-01-01']) {
  const response=await page.goto(base+route);
  check(response.status()===404,'Invalid evidence parameter must be 404: '+route);
 }
 return {result:'PASS',cases:results.length,results};
}
