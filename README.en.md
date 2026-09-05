# midscene-pc

Chinese README: [README.md](./README.md)

Control desktop apps and windows with Midscene. This package provides a PC device interface and service implementation that unifies mouse, keyboard, clipboard, and screenshot capabilities, integrating seamlessly with `@midscene/core` to drive desktop automation with natural language.

---

## 📖 Overview

- Desktop-oriented Midscene device implementation (`PCDevice`).
- Provides both local service (`localPCService`) and remote service (`createRemotePCService`) modes. Remote mode allows deploying a desktop-enabled Docker image on a server ([DockerHub](https://hub.docker.com/r/ppagent/midscene-ubuntu-desktop), [Git](https://github.com/Mofangbao/midscene-pc-docker)), so client programs don't need to run in a desktop environment, such as running scheduled tasks on servers.
- Supports multi-monitor, window enumeration and screenshots, encapsulates mouse/keyboard/clipboard operations.
- Deep integration with `@midscene/core`'s positioning and action system.
- Adapted to the input-primitives device contract of Midscene 1.10+.
- Ships a Windows window-level node app (`win-node-app`) exposing window capabilities and window-locked AI tasks over HTTP.

---

## 📺 Demos

### Play Music

[![播放音乐](https://github.com/user-attachments/assets/24ca286a-f581-42f5-a9ba-5b773017600a)](https://github.com/user-attachments/assets/24ca286a-f581-42f5-a9ba-5b773017600a)

### Send weather info to chat

[![发送消息](https://github.com/user-attachments/assets/5860b901-6e9b-4f90-a5a1-040b20dbd541)](https://github.com/user-attachments/assets/5860b901-6e9b-4f90-a5a1-040b20dbd541)

### System usage monitor (from remote server)

[![远程服务](https://github.com/user-attachments/assets/c7e667ad-4ad2-41b6-8457-c34e14aa1752)](https://github.com/user-attachments/assets/c7e667ad-4ad2-41b6-8457-c34e14aa1752)

## 🚀 Installation

> **Note:** Due to native library dependencies that require local compilation, installation may take some time.

### Integrate as a dependency into your own project

```bash
pnpm add midscene-pc
```

### Run directly as a service

Start the service directly using npx:

```bash
npx midscene-pc@latest
```

Specify port and host:

```bash
npx midscene-pc --port 4000 --host 127.0.0.1 --token your-remote-service-token
```

View help:

```bash
npx midscene-pc --help
```

---

## ⚙️ Environment Variable Configuration

The project supports configuration via environment variables. You can create a `.env` file or set system environment variables:

### Midscene Configuration

- `MIDSCENE_USE_QWEN3_VL`: Whether to use Qwen3 VL model, default `true`

### OpenAI Configuration

- `OPENAI_BASE_URL`: OpenAI API base URL, default `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `OPENAI_API_KEY`: OpenAI API key

### Model Configuration

- `MIDSCENE_MODEL_NAME`: Model name to use, default `qwen3-vl-plus`

### Server Configuration

- `PORT`: Server port, default `3333`
- `HOST`: Server host, default `0.0.0.0`
- `TOKEN`: Service access token, default `your-remote-service-token` (when set, access with `?token=your-remote-service-token`)

### Logging Configuration

- `LOG_LEVEL`: Log level, default `info` (options: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`)
- `LOG_DIR`: Log directory, default `./logs`
- `LOG_MAX_SIZE`: Maximum log file size, default `20m` (supports K, M, G units)
- `LOG_MAX_FILES`: Log file retention time, default `14d` (supports d, m units)
- `LOG_DATE_PATTERN`: Log file date pattern, default `YYYY-MM-DD`
- `NODE_ENV`: Set to `development` for colorized console output, use `production` for production

### Example `.env` file

```env
PORT=3333
HOST=0.0.0.0

# Environment Configuration
NODE_ENV=production

# Logging Configuration
LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
LOG_DATE_PATTERN=YYYY-MM-DD
```

---

## 🖥️ Cross-Platform Notes

- **Windows**: Normal installation
- **Linux**: Need to pre-install `libxss1` and `imagemagick`, both can be installed directly using `apt install`
- **macOS**: Need to allow screen capture and mouse/keyboard control (will automatically request permission on first use, complete in settings and restart the application). Also, don't use manual screenshot area selection on macOS as Node.js GUI message loop has poor compatibility on Mac
- **Note**: Due to dependencies on many cross-platform native libraries, you need to reinstall when switching platforms - simply copying `node_modules` won't work

---

## 🏃‍♂️ Quick Start (Local Mode)

```typescript
import "dotenv/config";
import { PCDevice, PCAgent, localPCService } from "midscene-pc";

async function main() {
  const device = new PCDevice({
    pcService: localPCService,
    launchOptions: {
      //   windowInfo: { appName: 'Edge' },
      screenArea: {
        preferManual: true, // Enable manual drawing mode. If no parameters are passed, defaults to primary monitor. You can also pass monitor ID, screenshot area, etc. See code implementation for details
      },
    },
  });
  await device.launch(); // Must initialize device first

  const agent = new PCAgent(device);
  await agent.aiAction("Open Google and search midscene");

  const answer = await agent.aiOutput("Describe the current desktop screenshot"); // PCAgent adds a method that supports directly returning answers
  console.log(answer);
}

main().catch(console.error);
```

---

## 🗄️ Locate Cache

`PCAgent` can cache locate results locally. This is useful for stable UIs and repeated runs, reducing repeated locating latency and model calls.

Enable cache by providing a cache id when creating `PCAgent` (the same id reuses the same cache data):

```typescript
const agent = new PCAgent(device, {
  cache: { id: "my-cache" },
});
```

Use cache by providing a stable `xpath` and setting `cacheable` in `aiLocate` / `aiTap`:

```typescript
await agent.aiTap("Click the Windows menu on the taskbar", {
  xpath: "/taskbar/menu",
  cacheable: true,
});
```

Cache data is stored at `./cache/<id>` by default. If the UI / resolution / scale changes, call `agent.clearCache()` or use a new cache id. See [cache.ts](./demo/cache.ts).

---

## 🌐 Remote Mode (HTTP Service Bridge)

Start the service on the target machine, then drive via HTTP client:

```typescript
import "dotenv/config";
import {
  startServer,
  createRemotePCService,
  PCDevice,
  PCAgent,
} from "midscene-pc";

async function main() {
  // For testing, you can start the service directly on localhost (default http://0.0.0.0:3333)
  await startServer();

  // Drive via HTTP
  const pcService = createRemotePCService("http://localhost:3333");
  const device = new PCDevice({ pcService, launchOptions: {} });
  await device.launch();

  const agent = new PCAgent(device);
  await agent.aiAction("Describe the current desktop situation");
}

main().catch(console.error);
```

### 🐳 Remote Server Installation Guide

![remote server](./main.jpg)

```bash
docker run -it -d --rm --name=midscene-ubuntu-desktop \
  -p 10081:10081 -p 10089:10089 -p 3333:3333 \
  --tmpfs /run --tmpfs /run/lock --tmpfs /tmp \
  --cap-add SYS_BOOT --cap-add SYS_ADMIN \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v ./data:/mnt/data \
  --cgroupns=host --privileged --shm-size=4g \
  -e L=zh_CN \
  -e SSH_PASS=midscene-pc \
  -e VNC_PASS=midscene-pc \
  -e VNC_PASS_RO=midscene_pc \
  ppagent/midscene-ubuntu-desktop:latest
```

> **Tip:** The service starts on port `3333` by default.  
> For more details, refer to [midscene-pc-docker](https://github.com/mofangbao/midscene-pc-docker)

---

## 🎯 Run Project Examples

This repository includes multiple demos, covering both local and remote usage.

### Local run

```bash
pnpm install
pnpm dev
```

### Remote run

```bash
# Simulate remote run
pnpm dev --remote
```

---

## 📋 Server API Overview

| Method | Path                    | Body                    | Response            | Notes                                        |
|--------|-------------------------|-------------------------|---------------------|----------------------------------------------|
| GET    | `/health`               | -                       | `{ ok: true }`      | Health check                                 |
| GET    | `/monitors`             | -                       | `Monitor[]`         | Monitor list                                 |
| GET    | `/monitors/:id/capture` | -                       | `image/png`         | Specific monitor screenshot                  |
| POST   | `/monitor/point`        | `{ x, y }`              | `Monitor \| null`   | Monitor at point                             |
| GET    | `/windows`              | -                       | `Window[]`          | Window list                                  |
| GET    | `/windows/:id/capture`  | -                       | `image/png`         | Specific window screenshot                   |
| POST   | `/mouse/set-position`   | `{ x, y }`              | `{ success: true }` | Set mouse position                           |
| GET    | `/mouse/position`       | -                       | `{ x, y }`          | Get mouse position                           |
| POST   | `/mouse/click`          | `{ button }`            | `{ success: true }` | Click (`MouseButton`)                        |
| POST   | `/mouse/double-click`   | `{ button }`            | `{ success: true }` | Double click (`MouseButton`)                 |
| POST   | `/mouse/press`          | `{ button }`            | `{ success: true }` | Press (`MouseButton`)                        |
| POST   | `/mouse/release`        | `{ button }`            | `{ success: true }` | Release (`MouseButton`)                      |
| POST   | `/mouse/move`           | `{ points: Point[] }`   | `{ success: true }` | Path movement                                |
| POST   | `/mouse/scroll/left`    | `{ distance }`          | `{ success: true }` | Horizontal scroll left                       |
| POST   | `/mouse/scroll/right`   | `{ distance }`          | `{ success: true }` | Horizontal scroll right                      |
| POST   | `/mouse/scroll/up`      | `{ distance }`          | `{ success: true }` | Vertical scroll up                           |
| POST   | `/mouse/scroll/down`    | `{ distance }`          | `{ success: true }` | Vertical scroll down                         |
| POST   | `/keyboard/press`       | `{ keys: number[] }`    | `{ success: true }` | Press keys (`KeyCode`)                       |
| POST   | `/keyboard/release`     | `{ keys: number[] }`    | `{ success: true }` | Release keys (`KeyCode`)                     |
| POST   | `/keyboard/type`        | `{ text }`              | `{ success: true }` | Type text                                    |
| POST   | `/clipboard/set`        | `{ content }`           | `{ success: true }` | Set clipboard                                |
| GET    | `/clipboard/get`        | -                       | `{ content }`       | Get clipboard                                |
| POST   | `/screenshot`           | `{ saveFileFullPath? }` | `{ rect, monitor }` | Capture screen (returns rectangle and monitor info) |

### Type Definitions

- **Monitor**: `{ id, name, x, y, width, height, rotation, scaleFactor, frequency, isPrimary }`
- **Window**: `{ id, appName, title, x, y, width, height, currentMonitor: Monitor }`
- **MouseButton**, **KeyCode** enums and **Point**, **Rect** types are exported from this package

---

## 🪟 Windows window-level node app (win-node-app)

Run an HTTP service inside a Windows desktop session to expose window-level capabilities (including Midscene AI tasks) to external systems:

```bash
# on the Windows machine, inside an interactive session
npm install midscene-pc
node node_modules/midscene-pc/dist/win-node-app.js
```

Env: `PORT` (3333), `HOST` (0.0.0.0), `TOKEN` (optional, requests must carry `?token=`), `ENABLE_AI=0` disables AI endpoints; model config still comes from `.env` (`MIDSCENE_MODEL_*`).

On top of the built-in PC service endpoints:

- `GET /api/windows` — visible windows (id/title/appName/geometry)
- `GET /api/windows/foreground` — foreground window handle
- `POST /api/windows/launch` `{ exe, args }` — start a GUI app in the desktop session
- `POST /api/windows/focus|minimize|restore` `{ id }` — window lifecycle
- `POST /api/windows/close` `{ id }` — politely close a window (WM_CLOSE, like clicking the X)
- `POST /api/ai/act` `{ windowId?, task }` — run an AI task locked to one window's rect
- `POST /api/ai/query` `{ windowId?, demand }` — extract structured data from the window screenshot
- `POST /api/ai/output` `{ windowId?, task }` — return the model's final answer (with timeout)
- `POST /api/ai/tap|input|locate` — single window-scoped steps
- `POST /api/agent/reset` — release cached window devices/agents
- `GET /api/config/model` — current model env (API keys echoed masked only)
- `POST /api/config/model` — hot-swap the model backend with a `values` map
- `POST /api/config/model/test` — probe a model endpoint without changing config

`windowId`/`title`/`appName` define the capture+click coordinate space: the model only sees and operates inside that window rect; omit them to target the primary monitor.

Model hot-configuration: `POST /api/config/model` accepts `MIDSCENE_MODEL_*`, `MIDSCENE_(INSIGHT|PLANNING)_MODEL_*`, `MIDSCENE_OPENAI_*`, `MIDSCENE_USE_*` and `MIDSCENE_REPLANNING_CYCLE_LIMIT`; a `null` value deletes a key. By default the change is written back to `.env` (pass `persist:false` to skip) and takes effect immediately — the model config cache is reset and cached agents rebuilt, no restart needed. Keys outside the allowlist (e.g. `PATH`) are rejected with 400; GET responses mask API keys.

> On Windows, Chinese text is typed via clipboard paste (Ctrl+V) — no IME dependency, code points verified lossless. Screenshot and input require an interactive (desktop) session; SSH/service sessions have no valid desktop handle.

---

## 📄 License

MIT

---

## 🔗 Related Links

- [Midscene.js Official Website](https://midscenejs.com/)
- [Model Selection Guide](https://midscenejs.com/choose-a-model)
- [Core Library (@midscene/core)](https://www.npmjs.com/package/@midscene/core)
