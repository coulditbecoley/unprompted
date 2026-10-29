// Section boundaries, rather than internal card spacing, match the shared 52px rhythm.
async page => {
  const results=[];
  await page.emulateMedia({reducedMotion: 'reduce', colorScheme: 'light'});
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    for (const u of ['/compare','/consensus','/questions','/methodology','/categories']) {
      await page.goto('http://127.0.0.1:3218'+u);
    const gaps = await page.evaluate(() => [...document.querySelectorAll('main h2')].map(h => {
      // distance from the previous visible element's bottom to this heading's top (or its label above)
      const top = (h.previousElementSibling && h.previousElementSibling.classList.contains('label') ? h.previousElementSibling : h).getBoundingClientRect().top;
      let prev = null, el = h;
      const all = [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); const visual = [...e.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()) || e.children.length === 0 || cs.borderBottomWidth !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)'; const closed = [...document.querySelectorAll("details:not([open])")].some(d => d !== e && d.contains(e) && !d.querySelector(":scope > summary")?.contains(e)); return !closed && visual && !['SECTION','MAIN'].includes(e.tagName) && r.height > 0 && r.bottom <= top + 0.5 && !e.contains(h) && !h.contains(e) && !e.classList.contains("sr-only") && cs.opacity !== "0"; });
      const bottom = Math.max(...all.map(e => e.getBoundingClientRect().bottom));
      return {heading: h.textContent.trim(), gap: Math.round(top - bottom), label: h.previousElementSibling?.classList.contains('label'), lead: h.nextElementSibling?.tagName === 'P'};
    }));
      if(gaps.some(g=>Math.abs(g.gap-52)>1 || !g.label || !g.lead)) throw new Error(JSON.stringify({u,width,gaps}));
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Page overflow: '+u);
      results.push({u,width,headers:gaps.length,gaps:[...new Set(gaps.map(g=>g.gap))]});
      await page.evaluate(()=>{const h=document.querySelector('main h2');const label=h.previousElementSibling;window.scrollTo(0,window.scrollY+label.getBoundingClientRect().top-200);});
      await page.screenshot({path:'.playwright-cli/codex-r12-'+u.slice(1)+'-'+width+'.png'});
    }
  }
  return {result:'PASS',results};
}
