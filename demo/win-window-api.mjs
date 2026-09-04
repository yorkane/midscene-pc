// End-to-end demo of the midscene-pc Windows window-level HTTP API (win-node-app).
// Run it from any machine that can reach the server:
//   BASE=http://127.0.0.1:3333 node demo/win-window-api.mjs
// What it exercises:
//   1. /health + /api/windows discovery
//   2. launch Chrome with a Chinese search keyword (deterministic, via URL)
//   3. window capture (/windows/:id/capture) and aiQuery on the locked window
//   4. agentic Chinese typing: aiAct types a Chinese keyword into Baidu and submits
//   5. window lifecycle: minimize -> restore -> focus -> foreground
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3333';
const OUT_DIR = process.env.OUT_DIR || '.';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function req(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + JSON.stringify(data).slice(0, 300));
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(url) {
  await req('/api/windows/launch', {
    method: 'POST',
    body: {
      exe: CHROME,
      args: ['--no-first-run', '--no-default-browser-check', '--new-window', url],
    },
  });
  for (let i = 0; i < 30; i++) {
    const wins = await req('/api/windows');
    const known = new Set(wins.filter((w) => /Chrome/i.test(w.appName)).map((w) => w.id));
    await sleep(1500);
    const after = await req('/api/windows');
    const fresh = after.find((w) => /Chrome/i.test(w.appName) && w.width > 600 && !known.has(w.id));
    if (fresh) return fresh;
  }
  throw new Error('no new chrome window appeared');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('STEP=health ' + JSON.stringify(await req('/health')));

  // ---- 1. deterministic Chinese search (keyword travels in the URL) ----
  const kwA = encodeURIComponent('杭州西湖');
  const chromeA = await launchChrome('https://www.baidu.com/s?wd=' + kwA);
  await sleep(5000);
  console.log('STEP=search_window id=' + chromeA.id + ' title=' + JSON.stringify(chromeA.title.slice(0, 40)));
  const pngA = await req('/windows/' + chromeA.id + '/capture');
  fs.writeFileSync(path.join(OUT_DIR, 'e2e_A.png'), pngA);
  console.log('STEP=search_capture bytes=' + pngA.length);
  const qa = await req('/api/ai/query', {
    method: 'POST',
    body: {
      windowId: chromeA.id,
      demand: '{ pageTitle: string, firstResultTitle: string }',
      opt: { prompt: '当前浏览器窗口的网页' },
    },
  });
  console.log('STEP=search_aiquery ' + JSON.stringify(qa).slice(0, 300));

  // ---- 2. agentic Chinese typing into the search box ----
  const chromeB = await launchChrome('https://www.baidu.com');
  await sleep(4000);
  console.log('STEP=type_window id=' + chromeB.id);
  const act = await req('/api/ai/act', {
    method: 'POST',
    body: {
      windowId: chromeB.id,
      refresh: true,
      task: '在百度的搜索输入框中输入中文关键词“上海天气”，然后点击“百度一下”按钮提交搜索',
      opt: { replanningCycleLimit: 6 },
    },
  });
  console.log('STEP=type_aiact ' + JSON.stringify(act).slice(0, 200));
  await sleep(6000);
  const pngB = await req('/windows/' + chromeB.id + '/capture');
  fs.writeFileSync(path.join(OUT_DIR, 'e2e_B.png'), pngB);
  const qb = await req('/api/ai/query', {
    method: 'POST',
    body: {
      windowId: chromeB.id,
      refresh: true,
      demand: '{ pageTitle: string, searchTerm: string }',
      opt: { prompt: '当前浏览器窗口的网页' },
    },
  });
  console.log('STEP=type_aiquery ' + JSON.stringify(qb).slice(0, 300));

  // ---- 3. window lifecycle (each answer carries the Win32 post-condition) ----
  const win = (await req('/api/windows')).find((w) => w.id === chromeB.id) ? chromeB.id : (await req('/api/windows')).find((w) => /Chrome/i.test(w.appName)).id;
  console.log('STEP=minimize ' + JSON.stringify(await req('/api/windows/minimize', { method: 'POST', body: { id: win } })));
  await sleep(1000);
  console.log('STEP=restore  ' + JSON.stringify(await req('/api/windows/restore', { method: 'POST', body: { id: win } })));
  await sleep(1000);
  console.log('STEP=focus    ' + JSON.stringify(await req('/api/windows/focus', { method: 'POST', body: { id: win } })));
  console.log('STEP=foreground ' + JSON.stringify(await req('/api/windows/foreground')));
  console.log('E2E_DONE');
}
main().catch((e) => {
  console.error('E2E_FAIL ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
  process.exit(1);
});
