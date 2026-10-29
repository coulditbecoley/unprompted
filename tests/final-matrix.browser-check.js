// Final QA matrix. Uses existing server; no messages or external writes.
async page => {
 const base='http://127.0.0.1:3218',results=[];
 const routes=['/compare','/consensus','/questions','/methodology','/categories','/missing-r14'];
 const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
 for(const width of [390,768,1440]) for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:900});
  for(const route of routes){
   await page.emulateMedia({colorScheme:theme,forcedColors:'none',reducedMotion:'no-preference',media:'screen'});
   const response=await page.goto(base+route);
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.waitForTimeout(700);
   const scope=page.locator('main > section');
   check(response.status()===(route.includes('missing')?404:200),'HTTP status '+route);
   const screen=await scope.evaluate(n=>({overflow:document.documentElement.scrollWidth>innerWidth,kpi:[...n.querySelectorAll('.kpi-row > *')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width}}),unlabelled:[...n.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>!e.labels?.length&&!e.getAttribute('aria-label')&&e.getAttribute('aria-hidden')!=='true').length}));
   check(!screen.overflow&&!screen.unlabelled,'Screen layout/labels '+route+' '+width+' '+theme);
   if(screen.kpi.length===3){const [a,b,c]=screen.kpi;check(width<900? a.y===b.y&&c.y>a.y&&Math.abs(c.w-(b.x+b.w-a.x))<2 : a.y===b.y&&a.y===c.y&&Math.abs(a.w-c.w)<2,'Shared KPI layout '+route+' '+width);}
   await page.screenshot({path:'.playwright-cli/codex-r14-'+route.slice(1)+'-'+width+'-'+theme+'.png'});
   await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
   const forced=await scope.evaluate(n=>({animations:n.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,overflow:document.documentElement.scrollWidth>innerWidth,dots:[...n.querySelectorAll('.cmp-history-dot')].map(e=>({b:e.classList.contains('is-b'),bg:getComputedStyle(e).backgroundColor})),agreement:[...n.querySelectorAll('.cns-strip > span')].map(e=>({yes:e.dataset.agreed,bg:getComputedStyle(e).backgroundColor}))}));
   check(!forced.animations&&!forced.overflow,'Forced/reduced '+route+' '+width);
   if(forced.dots.length)check(forced.dots.find(d=>d.b).bg!==forced.dots.find(d=>!d.b).bg,'History marks lost');
   if(forced.agreement.some(d=>d.yes==='true'))check(forced.agreement.find(d=>d.yes==='true').bg!==forced.agreement.find(d=>d.yes==='false').bg,'Agreement marks lost');
   results.push({route,width,theme,screen:'PASS',forced:'PASS',reducedMotion:'PASS'});
  }
 }
 return {result:'PASS',cases:results.length,results};
}
