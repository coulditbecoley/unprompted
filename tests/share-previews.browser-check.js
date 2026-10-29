// Run with playwright-cli run-code --filename=tests/share-previews.browser-check.js.
async page => {
 const base = 'http://127.0.0.1:3218';
 const check = (ok, message) => { if (!ok) throw new Error(message); };
 const defaults = new Map();
 const results = [];
 for (const route of ['/compare', '/consensus', '/questions', '/categories', '/compare?c=ai-writing-tools&a=claude&b=chatgpt', '/consensus?c=ai-image-generators', '/questions?brand=Cursor&question=q01']) {
  await page.goto(base + route);
  const meta = await page.evaluate(() => Object.fromEntries(['image', 'image:alt', 'image:width', 'image:height'].map(key => [key, document.querySelector(`meta[property="og:${key}"]`)?.content])));
  const path = route.split('?')[0];
  check(meta.image && meta['image:alt'], 'Missing share metadata: ' + route);
  check(meta['image:width'] === '1200' && meta['image:height'] === '630', 'Wrong declared dimensions: ' + route);
  const image = new URL(meta.image);
  check(image.pathname.startsWith(path + '/opengraph-image'), 'Wrong page card: ' + route);
  if (route.includes('?')) check(defaults.get(path) === meta.image, 'Query URL must retain the labelled default card: ' + route);
  else defaults.set(path, meta.image);
  image.host = new URL(base).host;
  image.protocol = 'http:';
  const response = await page.request.get(image.href);
  check(response.ok() && response.headers()['content-type'].startsWith('image/png'), 'Card did not render: ' + route);
  const png = await response.body();
  check(png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'Wrong actual PNG dimensions: ' + route);
  results.push({ route, bytes: png.length });
 }
 return results;
}
