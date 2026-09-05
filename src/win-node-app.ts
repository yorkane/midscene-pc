/**
 * Windows 端节点应用：给外部系统调用的窗口级接口。
 *
 * 组合两层能力：
 *   1. midscene-pc 自带的 HTTP PC service（/health /monitors /windows /windows/:id/capture
 *      /mouse/* /keyboard/* /clipboard/* /screenshot）：窗口枚举、窗口级截图、底层输入；
 *   2. 本文件新增的 /api/* 端点：窗口生命周期（列表/聚焦/最小化/恢复）与
 *      窗口锁定的 AI 任务（aiAct / aiQuery / aiOutput / aiTap / aiInput / aiLocate）。
 *
 * 必须在 Windows 桌面会话内运行（native 截屏与输入要求交互会话）。
 * 环境变量：PORT(3333) HOST(0.0.0.0) TOKEN(MIDSCENE_PC_TOKEN) ENABLE_AI(默认开，0 关)
 * 模型环境变量走 .env（MIDSCENE_MODEL_* 系列）。
 */
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PCDevice from './pc.device.js';
import { PCAgent } from './pc.agent.js';
import { localPCService } from './services/local.pc.service.js';
import { createServer as createPcServer } from './server.js';
import { globalModelConfigManager } from '@midscene/shared/env';
import type { Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3333;
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.TOKEN ?? process.env.MIDSCENE_PC_TOKEN;
const ENABLE_AI = process.env.ENABLE_AI !== '0';
function resolveWindowFnScript(): string {
  // dist/win-node-app.js and src/win-node-app.ts both sit one level below the package root
  const candidates = [
    path.join(__dirname, '..', 'assets', 'win-window-fn.ps1'),
    path.join(__dirname, '..', '..', 'assets', 'win-window-fn.ps1'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}
const WINDOW_FN_SCRIPT = resolveWindowFnScript();
if (!fs.existsSync(WINDOW_FN_SCRIPT)) {
  console.warn('[win-node-app] window helper script not found: ' + WINDOW_FN_SCRIPT);
}

const app = express();
app.use(express.json({ limit: '25mb' }));

if (TOKEN) {
  app.use((req, res, next) => {
    if (req.query.token !== TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
}

// mount the built-in window-level PC service (monitors/windows/capture/mouse/keyboard/clipboard)
app.use(createPcServer(localPCService));

// ---------- window lifecycle ----------
function runWindowFn(action: string, id = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOW_FN_SCRIPT, '-Action', action, '-Id', String(id)],
      { windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => {
        if (err && !stdout) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

// The helper prints a single line of space-separated key=value pairs, e.g.
// "focus=true fg=262850 iconic=false" or "error=compile failed: ...".
function parseWindowFn(out: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const tok of out.split(/\s+/).filter(Boolean)) {
    const i = tok.indexOf('=');
    if (i > 0) kv[tok.slice(0, i)] = tok.slice(i + 1);
    else if (!(tok in kv)) kv[tok] = 'true';
  }
  return kv;
}

app.get('/api/windows', async (_req: Request, res: Response) => {
  try {
    const wins = await localPCService.allWindows();
    res.json(
      wins
        .filter((w) => w.width > 0 && w.height > 0)
        .map((w) => ({ id: w.id, title: w.title, appName: w.appName, x: w.x, y: w.y, width: w.width, height: w.height })),
    );
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

async function windowAction(req: Request, res: Response, action: string) {
  try {
    const id = Number(req.body?.id);
    if (!id) {
      res.status(400).json({ error: 'id required' });
      return;
    }
    const out = await runWindowFn(action, id);
    const state = parseWindowFn(out);
    if (state.error !== undefined) {
      res.status(500).json({ ok: false, error: out.replace(/^error=/, '') });
      return;
    }
    // Honest verdict per action: the action "succeeded" only when the
    // post-condition observed from Win32 says so.
    const verdict: Record<string, string | undefined> = {
      minimize: state.minimized,
      restore: state.restored,
      focus: state.focus,
      close: state.closed,
    };
    const ok = verdict[action] === 'true';
    res.json({ ok, action, state });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}

app.post('/api/windows/focus', (req, res) => windowAction(req, res, 'focus'));
app.post('/api/windows/minimize', (req, res) => windowAction(req, res, 'minimize'));
app.post('/api/windows/restore', (req, res) => windowAction(req, res, 'restore'));
app.post('/api/windows/close', (req, res) => windowAction(req, res, 'close'));
app.post('/api/windows/launch', (req: Request, res: Response) => {
  try {
    const exe = String(req.body?.exe ?? '');
    const args = Array.isArray(req.body?.args) ? (req.body.args as unknown[]).map((a) => String(a)) : [];
    if (!exe) {
      res.status(400).json({ error: 'exe required' });
      return;
    }
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    res.json({ ok: true, pid: child.pid });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.get('/api/windows/foreground', async (_req: Request, res: Response) => {
  try {
    const state = parseWindowFn(await runWindowFn('foreground'));
    res.json({ hwnd: Number(state.fg ?? 0) });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ---------- window-locked AI ----------
interface AgentEntry {
  device: PCDevice;
  agent: PCAgent;
}
const agentCache = new Map<string, AgentEntry>();

function windowKeyOf(body: any): { key: string; windowInfo: any } {
  const windowInfo: any = {};
  if (body?.windowId) windowInfo.id = Number(body.windowId);
  if (body?.title) windowInfo.title = String(body.title);
  if (body?.appName) windowInfo.appName = String(body.appName);
  if (body?.onlyForRect !== undefined) windowInfo.onlyForRect = Boolean(body.onlyForRect);
  if (body?.fixedWindow !== undefined) windowInfo.fixedWindow = Boolean(body.fixedWindow);
  return { key: JSON.stringify(windowInfo), windowInfo };
}

async function getAgent(body: any): Promise<AgentEntry> {
  const { key, windowInfo } = windowKeyOf(body);
  const cached = agentCache.get(key);
  if (cached && !body?.refresh) return cached;
  const device = new PCDevice({
    pcService: localPCService,
    launchOptions: Object.keys(windowInfo).length ? { windowInfo } : undefined,
  } as any);
  await device.launch();
  const agent = new PCAgent(device, {
    cacheId: body?.cacheId ? String(body.cacheId) : undefined,
    generateReport: false,
  } as any);
  const entry = { device, agent };
  agentCache.set(key, entry);
  return entry;
}

async function aiGuard(req: Request, res: Response, fn: () => Promise<any>) {
  if (!ENABLE_AI) {
    res.status(503).json({ error: 'AI endpoints disabled (ENABLE_AI=0)' });
    return;
  }
  try {
    const out = await fn();
    res.json({ ok: true, result: out ?? null });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
}

app.post('/api/ai/act', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    return await agent.aiAct(String(req.body?.task ?? ''), req.body?.opt);
  });
});

app.post('/api/ai/query', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    return await agent.aiQuery(req.body?.demand ?? String(req.body?.task ?? ''), req.body?.opt);
  });
});

app.post('/api/ai/output', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    const timeoutMs = Number(req.body?.timeoutMs ?? 120000);
    const task = String(req.body?.task ?? '');
    const timeout = new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error('aiOutput timeout')), timeoutMs);
      t.unref();
    });
    return await Promise.race([agent.aiOutput(task), timeout]);
  });
});

app.post('/api/ai/tap', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    return await agent.aiTap(String(req.body?.target ?? ''), req.body?.opt);
  });
});

app.post('/api/ai/input', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    const value = String(req.body?.value ?? '');
    const target = String(req.body?.target ?? '');
    return await agent.aiInput(value, target, req.body?.opt);
  });
});

app.post('/api/ai/locate', async (req, res) => {
  await aiGuard(req, res, async () => {
    const { agent } = await getAgent(req.body);
    const loc = await agent.aiLocate(String(req.body?.target ?? ''), req.body?.opt);
    return { center: (loc as any).center, rect: (loc as any).rect };
  });
});

app.post('/api/agent/reset', (_req: Request, res: Response) => {
  for (const entry of agentCache.values()) {
    try {
      entry.device.destroy();
    } catch {}
  }
  agentCache.clear();
  res.json({ ok: true });
});

// ---------- runtime model configuration ----------
// Hot-reconfigure the model backend without restarting the process:
// globalConfigManager reads process.env live, and clearModelConfigMap()
// resets the lazily-parsed model config, so the NEXT AI call already uses
// the new values. Cached agents are rebuilt (they bind the model lazily,
// but their device/driver state should not survive a backend switch).
const MODEL_ENV_PATTERN = /^MIDSCENE_(USE_[A-Za-z0-9_]+|(INSIGHT_|PLANNING_)?MODEL_[A-Za-z0-9_]+|OPENAI_[A-Za-z0-9_]+|REPLANNING_CYCLE_LIMIT)$/;
const ENV_FILE = process.env.MIDSCENE_PC_ENV_FILE || path.join(__dirname, '..', '.env');
const SECRET_KEY_PATTERN = /API_KEY|TOKEN/;
function maskValue(name: string, value: string): string {
  if (!SECRET_KEY_PATTERN.test(name)) return value;
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}
function currentModelEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && MODEL_ENV_PATTERN.test(k)) out[k] = maskValue(k, v);
  }
  return out;
}
// Minimal dotenv-compatible upsert so a container restart keeps the config.
// Verified against dotenv v16 (the reader used at startup): double-quoted
// values are taken *literally* (no backslash unescaping), so escaping quotes
// with backslashes corrupts JSON values. The faithful encodings are: bare
// values, or single-quoted for anything containing spaces/#/quotes.
function upsertEnvFile(updates: Record<string, string | null>): void {
  const existing: Record<string, string> = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) existing[m[1]!] = m[2]!;
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete existing[k];
    else existing[k] = v;
  }
  const dq2 = String.fromCharCode(34);
  const sq2 = String.fromCharCode(39);
  const strip = (raw: string): string => {
    if (raw.length >= 2 && raw.startsWith(sq2) && raw.endsWith(sq2)) return raw.slice(1, -1).split(sq2 + sq2).join(sq2);
    if (raw.length >= 2 && raw.startsWith(dq2) && raw.endsWith(dq2)) {
      // Legacy files from the previous writer hold double-quoted JSON with
      // backslash escapes; dotenv reads those literally, so unescape here to
      // repair the value (any rewrite re-emits it in a dotenv-faithful form).
      const inner = raw.slice(1, -1);
      const bs3 = String.fromCharCode(92);
      if (!inner.includes(bs3)) return inner;
      let out = '';
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === bs3 && (inner[i + 1] === bs3 || inner[i + 1] === dq2)) { out += inner[i + 1]; i++; }
        else out += inner[i];
      }
      return out;
    }
    return raw;
  };
  const lines = Object.entries(existing).map(([k, raw]) => {
    const v = strip(raw);
    if (/^[A-Za-z0-9 ._@:/+=,-]*$/.test(v) && !/#/.test(v) && v.length > 0) return k + '=' + v;
    if (!v.includes(sq2)) return k + '=' + sq2 + v + sq2;
    if (!v.includes(dq2)) return k + '=' + dq2 + v + dq2;
    throw new Error('value for ' + k + ' contains both quote characters; refuse to write');
  });
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n');
}
function invalidateModelConfig() {
  try {
    globalModelConfigManager.clearModelConfigMap();
  } catch (e: any) {
    console.warn('[config] clearModelConfigMap failed: ' + (e?.message ?? e));
  }
  for (const entry of agentCache.values()) {
    try {
      entry.device.destroy();
    } catch {}
  }
  agentCache.clear();
}
app.get('/api/config/model', (_req: Request, res: Response) => {
  res.json({ env: currentModelEnv(), envFile: ENV_FILE });
});
app.post('/api/config/model', (req: Request, res: Response) => {
  try {
    const values = (req.body?.values ?? req.body) as Record<string, unknown>;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      res.status(400).json({ ok: false, error: 'body must be { values: { KEY: string-or-null } }' });
      return;
    }
    const updates: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!MODEL_ENV_PATTERN.test(k)) {
        res.status(400).json({ ok: false, error: 'forbidden key: ' + k + ' (only MIDSCENE_* model keys are settable)' });
        return;
      }
      if (v !== null && typeof v !== 'string') {
        res.status(400).json({ ok: false, error: 'value for ' + k + ' must be a string or null' });
        return;
      }
      updates[k] = v as string | null;
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ ok: false, error: 'no updates given' });
      return;
    }
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) delete process.env[k];
      else process.env[k] = v;
    }
    // persisted: true = written to env file; 'skipped' = persist:false requested;
    // false = write failed (see persistError).
    let persisted: boolean | 'skipped' = true;
    let persistError: string | undefined;
    if (req.body?.persist === false) {
      persisted = 'skipped';
    } else {
      try {
        upsertEnvFile(updates);
      } catch (e: any) {
        persisted = false;
        persistError = String(e?.message ?? e);
        console.warn('[config] env file write failed: ' + persistError);
      }
    }
    invalidateModelConfig();
    res.json({ ok: true, applied: Object.keys(updates), persisted, persistError, agentsReset: true, env: currentModelEnv() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});
// Connectivity probe without touching live config: GET {base}/models.
app.post('/api/config/model/test', async (req: Request, res: Response) => {
  const base = String(req.body?.base_url ?? process.env.MIDSCENE_MODEL_BASE_URL ?? '').replace(/\/+$/, '');
  const key = String(req.body?.api_key ?? process.env.MIDSCENE_MODEL_API_KEY ?? '');
  if (!base || !key) {
    res.status(400).json({ ok: false, error: 'base_url and api_key are required (body or env)' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(base + '/models', { headers: { authorization: 'Bearer ' + key }, signal: controller.signal });
    const bodyText = await r.text();
    let models: string[] = [];
    try {
      models = (JSON.parse(bodyText)?.data ?? []).map((m: any) => m?.id).filter(Boolean).slice(0, 20);
    } catch {}
    res.json({ ok: r.ok, status: r.status, models, note: r.ok ? undefined : bodyText.slice(0, 300) });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: String(err?.message ?? err) });
  } finally {
    clearTimeout(timer);
  }
});
app.listen(PORT, HOST, () => {
  console.log('[win-node-app] window-level API listening on http://' + HOST + ':' + PORT + (TOKEN ? ' (token protected)' : ''));
  console.log('[win-node-app] AI endpoints ' + (ENABLE_AI ? 'enabled' : 'disabled'));
});
