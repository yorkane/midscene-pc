// End-to-end demo of the midscene-pc Windows window-level HTTP API (win-node-app).
// Run it from any machine that can reach the server:
//   BASE=http://127.0.0.1:3333 node demo/win-window-api.mjs
// What it exercises:
//   1. /health + /api/windows discovery
//   2. launch Chrome with a Chinese search keyword (deterministic, via URL)
//   3. window focus + capture + aiQuery on the locked window
//   4. agentic Chinese typing: aiAct types a Chinese keyword into Baidu and submits
//   5. hard assertions: the AI must actually see the Chinese keywords
//   6. window lifecycle: minimize -> restore -> focus -> foreground -> close
//
// Practical notes baked in (learned on a real Tiny11/Win11 VM):
// - Use a dedicated --user-data-dir: sharing the default profile makes Chrome
//   recycle its top-level window (new HWND) during session-restore, which races
//   any window id held by the caller. Crash-restore bubbles are suppressed.
// - Chrome can still recreate the HWND while the first page loads, so every
//   operation re-resolves the window by title right before touching it.
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3333';
const OUT_DIR = process.env.OUT_DIR || '.';
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = process.env.CHROME_PROFILE || 'C:\\mspc-in\\chrome-e2e';

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

function isAppWindow(w) {
  // real top-level app windows only: sizable, not Chrome's transient popups
  return /Chrome/i.test(w.appName) && w.width > 600 && w.title.indexOf('Restore') < 0 && w.title.indexOf('Translate') < 0;
}

async function findWin(titleKeyword) {
  const wins = await req('/api/windows');
  return wins.find(function (w) { return isAppWindow(w) && w.title.indexOf(titleKeyword) >= 0; }) || null;
}

async function resolveWin(titleKeyword, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000);
  while (Date.now() < deadline) {
    const hit = await findWin(titleKeyword);
    if (hit) return hit;
    await sleep(1500);
  }
  throw new Error('no window titled like: ' + titleKeyword);
}

function chromeArgs(url) {
  return [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--user-data-dir=' + PROFILE,
    '--new-window',
    url,
  ];
}
function launchChrome(url) {
  return req('/api/windows/launch', { method: 'POST', body: { exe: CHROME, args: chromeArgs(url) } });
}

async function focusWin(id) {
  const r = await req('/api/windows/focus', { method: 'POST', body: { id: id } });
  await sleep(700);
  return r;
}

// Lock the AI onto a window by TITLE, not by HWND: browsers recreate their
// top-level window (new HWND) while navigating, but the title stays the
// anchor. fixedWindow:false makes the device re-resolve the window before
// every capture/action, so the drifting handle no longer matters.
function aiBody(titleKeyword, extra) {
  return Object.assign({ title: titleKeyword, fixedWindow: false }, extra || {});
}
async function aiCall(kind, url, titleKeyword, extra) {
  const win = await resolveWin(titleKeyword, 30000);
  await focusWin(win.id);
  try {
    return await req('/api/ai/' + kind, { method: 'POST', body: aiBody(titleKeyword, extra) });
  } catch (e) {
    if (!/not found/i.test(String(e.message))) throw e;
    console.log('STEP=' + kind + '_retry reason=' + String(e.message).slice(0, 120));
    if (!(await findWin(titleKeyword))) {
      await launchChrome(url);
    }
    const w2 = await resolveWin(titleKeyword, 60000);
    await focusWin(w2.id);
    await sleep(1500);
    return await req('/api/ai/' + kind, { method: 'POST', body: aiBody(titleKeyword, extra) });
  }
}

async function capture(titleKeyword, outFile) {
  const win = await resolveWin(titleKeyword, 20000);
  const png = await req('/windows/' + win.id + '/capture');
  fs.writeFileSync(path.join(OUT_DIR, outFile), png);
  console.log('STEP=capture ' + outFile + ' bytes=' + png.length + ' window=' + win.id);
  return win;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('STEP=health ' + JSON.stringify(await req('/health')));

  // ---- 1. deterministic Chinese search (keyword travels in the URL) ----
  const keywordA = '杭州西湖';
  const urlA = 'https://www.baidu.com/s?wd=' + encodeURIComponent(keywordA);
  const titleA = keywordA + '_百度搜索';
  await launchChrome(urlA);
  const winA0 = await resolveWin(titleA);
  console.log('STEP=search_window id=' + winA0.id + ' title=' + JSON.stringify(winA0.title.slice(0, 40)));
  await capture(titleA, 'e2e_A.png');
  const qa = await aiCall('query', urlA, titleA, {
    demand: '{ pageTitle: string, firstResultTitle: string }',
    opt: { prompt: '当前浏览器窗口的网页' },
  });
  console.log('STEP=search_aiquery ' + JSON.stringify(qa).slice(0, 300));

  // ---- 2. agentic Chinese typing into the search box ----
  const urlB = 'https://www.baidu.com/?r=' + Date.now();
  await launchChrome(urlB);
  await resolveWin('百度一下');
  console.log('STEP=type_start');
  // aiAct must land the typed text; after submit the title becomes 上海天气_百度搜索
  let act;
  try {
    // after submit the page title changes; the device may then report the
    // window as gone even though the click landed -- the result title is the
    // ground truth, so tolerate that specific failure and verify below.
    act = await aiCall('act', urlB, '百度一下', {
      refresh: true,
      task: '在百度的搜索输入框中输入中文关键词“上海天气”，然后点击“百度一下”按钮提交搜索',
      opt: { replanningCycleLimit: 12 },
    });
  } catch (e) {
    console.log('STEP=type_aiact_error ' + String(e.message).slice(0, 160));
  }
  if (act) console.log('STEP=type_aiact ' + JSON.stringify(act).slice(0, 200));

  const winB2 = await resolveWin('上海天气_百度搜索', 60000);
  console.log('STEP=typed_window id=' + winB2.id);
  await focusWin(winB2.id);
  await capture('上海天气_百度搜索', 'e2e_B.png');
  const qb = await aiCall('query', 'https://www.baidu.com/s?wd=' + encodeURIComponent('上海天气'), '上海天气_百度搜索', {
    refresh: true,
    demand: '{ pageTitle: string, searchTerm: string }',
    opt: { prompt: '当前浏览器窗口的网页' },
  });
  console.log('STEP=typed_aiquery ' + JSON.stringify(qb).slice(0, 300));

  // ---- 3. hard assertions on real evidence ----
  const qaStr = JSON.stringify(qa);
  const qbStr = JSON.stringify(qb);
  if (qaStr.indexOf(keywordA) < 0) throw new Error('assert A failed: aiQuery did not see the keyword: ' + qaStr.slice(0, 200));
  if (qbStr.indexOf('上海天气') < 0) throw new Error('assert B failed: typed keyword not visible: ' + qbStr.slice(0, 200));
  console.log('ASSERT=aiquery_contains_chinese_keywords OK');

  // ---- 4. window lifecycle (each answer carries the Win32 post-condition) ----
  // NB: the page title keeps evolving after submit (上海天气_天气预报 ...),
  // so anchor on the keyword only.
  const win = await resolveWin('上海天气', 15000);
  console.log('STEP=minimize ' + JSON.stringify(await req('/api/windows/minimize', { method: 'POST', body: { id: win.id } })));
  await sleep(1000);
  const r2 = await resolveWin('上海天气', 15000);
  console.log('STEP=restore  ' + JSON.stringify(await req('/api/windows/restore', { method: 'POST', body: { id: r2.id } })));
  await sleep(1000);
  const r3 = await resolveWin('上海天气', 15000);
  console.log('STEP=focus    ' + JSON.stringify(await req('/api/windows/focus', { method: 'POST', body: { id: r3.id } })));
  console.log('STEP=foreground ' + JSON.stringify(await req('/api/windows/foreground')));
  console.log('STEP=close    ' + JSON.stringify(await req('/api/windows/close', { method: 'POST', body: { id: r3.id } })));
  console.log('E2E_DONE');
}
main().catch((e) => {
  console.error('E2E_FAIL ' + (e && e.stack ? e.stack.slice(0, 600) : String(e)));
  process.exit(1);
});
