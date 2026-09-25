import { createServer } from 'node:http';

export function createFixtureServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname !== '/') {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Fixture: page not found');
      return;
    }
    const broken = url.searchParams.get('regression') === '1';
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Northstar — demo storefront</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f8f7f3;color:#202a28;font-family:Arial,sans-serif}header{display:flex;justify-content:space-between;padding:30px 60px;border-bottom:1px solid #dddcd5}main{max-width:1120px;margin:80px auto;display:grid;grid-template-columns:1fr 1fr;gap:72px}.art{height:430px;background:#dbe8dd;border-radius:12px;display:grid;place-items:center}.object{width:220px;height:270px;background:#405c48;border-radius:80px 80px 28px 28px;box-shadow:18px 22px 0 #bdd0c1}.tag{font-size:12px;letter-spacing:3px;color:#61776b}h1{font-size:58px;line-height:1.05;letter-spacing:-2px;margin:24px 0}p{font-size:18px;line-height:1.6;color:#59615a}.price{font-size:28px;color:#202a28}button{border:0;border-radius:8px;padding:18px 30px;background:${broken ? '#c9583f' : '#244b39'};color:white;font-size:16px;width:${broken ? '160' : '280'}px}a{color:inherit}footer{max-width:1120px;margin:auto;border-top:1px solid #dddcd5;padding-top:24px;color:#69736b;font-size:13px}@media(max-width:700px){header{padding:24px}main{margin:30px 24px;grid-template-columns:1fr;gap:24px}h1{font-size:40px}.art{height:260px}.object{height:180px;width:150px}footer{margin:24px}}</style></head>
<body><header><strong>NORTHSTAR</strong><span>Objects for everyday living</span></header><main><div class="art" aria-label="Forest green backpack illustration"><div class="object"></div></div><section><span class="tag">THE EVERYDAY COLLECTION</span><h1>A little less.<br>A little better.</h1><p>Meet the Daypack. Thoughtful details, recycled fabric, and room for whatever the day brings.</p><p class="price">€89.00</p><button type="button">${broken ? 'Buy' : 'Add to your everyday'}</button><p><a href="${broken ? '/missing-shipping' : '/'}">Shipping and returns</a></p></section></main><footer>Controlled ReleaseCheck fixture · No external fonts, images, analytics, or live data.</footer>
<script>${broken ? "fetch('/missing-resource').finally(() => { document.documentElement.dataset.ready = 'true'; }); throw new Error('Demo regression: cart is unavailable');" : "document.documentElement.dataset.ready = 'true';"}</script></body></html>`);
  });
}
