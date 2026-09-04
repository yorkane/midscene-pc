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
    res.json({ ok: out.toLowerCase() === 'true' || out.length > 0, raw: out });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}

app.post('/api/windows/focus', (req, res) => windowAction(req, res, 'focus'));
app.post('/api/windows/minimize', (req, res) => windowAction(req, res, 'minimize'));
app.post('/api/windows/restore', (req, res) => windowAction(req, res, 'restore'));
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
    res.json({ hwnd: Number(await runWindowFn('foreground')) });
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

app.listen(PORT, HOST, () => {
  console.log('[win-node-app] window-level API listening on http://' + HOST + ':' + PORT + (TOKEN ? ' (token protected)' : ''));
  console.log('[win-node-app] AI endpoints ' + (ENABLE_AI ? 'enabled' : 'disabled'));
});
