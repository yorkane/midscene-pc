# midscene-pc

English README: [README.en.md](./README.en.md)

让 Midscene 直接控制你的桌面应用与窗口。本库提供一个 PC 设备接口及服务实现，统一鼠标、键盘、剪贴板与截图等能力，并与 `@midscene/core` 无缝协作，让你用自然语言驱动桌面自动化。

---

## 📖 简介

- 面向桌面场景的 Midscene 设备实现（`PCDevice`）。
- 提供本地服务（`localPCService`）与远程服务（`createRemotePCService`）两种模式。远程模式可以在服务器上部署一个带桌面的 docker 镜像（[DockerHub 地址](https://hub.docker.com/r/ppagent/midscene-ubuntu-desktop)，[Git地址](https://github.com/Mofangbao/midscene-pc-docker)），然后客户端程序就不需要在桌面环境下运行了，比如可以放到服务器上去定时运行等。
- 支持多显示器、窗口枚举与截图，封装鼠标/键盘/剪贴板操作。
- 与 `@midscene/core` 的定位与动作体系深度集成。
- 适配 Midscene 1.10+ 的输入原语（input primitives）设备契约。
- 内置 Windows 窗口级节点应用 `win-node-app`，把窗口能力与窗口锁定的 AI 任务以 HTTP 接口暴露给外部系统。



## 📺 演示

### 播放音乐

[![播放音乐](https://github.com/user-attachments/assets/24ca286a-f581-42f5-a9ba-5b773017600a)](https://github.com/user-attachments/assets/24ca286a-f581-42f5-a9ba-5b773017600a)

### 搜索天气发送到聊天

[![发送消息](https://github.com/user-attachments/assets/5860b901-6e9b-4f90-a5a1-040b20dbd541)](https://github.com/user-attachments/assets/5860b901-6e9b-4f90-a5a1-040b20dbd541)

### 查看资源占用（连接到远程服务）

[![远程服务](https://github.com/user-attachments/assets/c7e667ad-4ad2-41b6-8457-c34e14aa1752)](https://github.com/user-attachments/assets/c7e667ad-4ad2-41b6-8457-c34e14aa1752)

## 🚀 安装

> **注意：** 由于依赖的库文件需要本地化编译，耗时可能略久。

### 作为依赖集成到自己项目中

```bash
pnpm add midscene-pc
```

### 作为服务直接运行

使用 npx 直接启动服务：

```bash
npx midscene-pc@latest
```

指定端口与主机：

```bash
npx midscene-pc --port 4000 --host 127.0.0.1 --token your-remote-service-token
```

查看帮助：

```bash
npx midscene-pc --help
```

---

## ⚙️ 环境变量配置

项目支持通过环境变量进行配置，你可以创建 `.env` 文件或设置系统环境变量：

### Midscene 配置

- `MIDSCENE_USE_QWEN3_VL`: 是否使用 Qwen3 VL 模型，默认 `true`

### OpenAI 配置

- `OPENAI_BASE_URL`: OpenAI API 基础 URL，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `OPENAI_API_KEY`: OpenAI API 密钥

### 模型配置

- `MIDSCENE_MODEL_NAME`: 使用的模型名称，默认 `qwen3-vl-plus`

### 服务器配置

- `PORT`: 服务端口，默认 `3333`
- `HOST`: 服务主机，默认 `0.0.0.0`
- `TOKEN`: 服务访问令牌，env中默认 `your-remote-service-token`（如果设置了令牌，客户端调用时需要使用?token=your-remote-service-token`）

### 日志配置

- `LOG_LEVEL`: 日志级别，默认 `info`（可选：`error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`）
- `LOG_DIR`: 日志目录，默认 `./logs`
- `LOG_MAX_SIZE`: 日志文件最大大小，默认 `20m`（支持 K、M、G 单位）
- `LOG_MAX_FILES`: 日志文件保留时间，默认 `14d`（支持 d、m 等单位）
- `LOG_DATE_PATTERN`: 日志文件日期格式，默认 `YYYY-MM-DD`
- `NODE_ENV`: 设置为 `development` 时会在控制台输出彩色日志，生产环境建议设置为 `production`

### 示例 `.env` 文件

```env
PORT=3333
HOST=0.0.0.0

# 环境配置
NODE_ENV=production

# 日志配置
LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d
LOG_DATE_PATTERN=YYYY-MM-DD
```

---

## 🖥️ 跨平台提示

- **Windows**: 正常安装
- **Linux**: 需要提前安装 `libxss1`、`imagemagick`，均使用 `apt install` 直接安装
- **macOS**: 需要允许屏幕截图和鼠标键盘控制（第一次的时候会自动申请，设置里面完成后，重新启动应用），另外 macOS 模式下不要使用人工圈画截图区域的功能，Node.js 的 GUI 消息循环在 Mac 下兼容性不好
- **注意**: 由于依赖不少跨平台的本地库，因此换平台的时候需要重新 install，直接拷贝 `node_modules` 是没用的

---

## 🏃‍♂️ 快速开始（本地模式）

```typescript
import "dotenv/config";
import { PCDevice, PCAgent, localPCService } from "midscene-pc";

async function main() {
  const device = new PCDevice({
    pcService: localPCService,
    launchOptions: {
      //   windowInfo: { appName: 'Edge' },
      screenArea: {
        preferManual: true, // 启动手动绘制模式。如果不传参数，默认primary显示器，也可以传递显示器的id、截图区域等，具体可以参考代码实现
      },
    },
  });
  await device.launch(); // 必须先初始化设备

  const agent = new PCAgent(device);
  await agent.aiAction("打开谷歌，搜索 midscene");

  const answer = await agent.aiOutput("描述一下当前桌面截图"); // PCAgent增加了一个支持直接返回答案的方法。
  console.log(answer);
}

main().catch(console.error);
```

---

## 🗄️ 定位缓存（Cache）

`PCAgent` 支持对定位结果做本地缓存，适用于 UI 稳定、重复运行的脚本场景，可减少重复定位带来的耗时与模型调用。

启用缓存：创建 `PCAgent` 时指定缓存 id（同一 id 会复用同一份缓存数据）：

```typescript
const agent = new PCAgent(device, {
  cache: { id: "my-cache" },
});
```

使用缓存：在需要缓存的 `aiLocate` / `aiTap` 调用中，提供稳定的 `xpath` 并开启 `cacheable`：

```typescript
await agent.aiTap("任务栏上的 Windows 菜单", {
  xpath: "/taskbar/menu",
  cacheable: true,
});
```

缓存数据默认写入 `./cache/<id>`。如果 UI / 分辨率 / 缩放变化导致缓存失效，可调用 `agent.clearCache()` 或更换缓存 id。示例见 [cache.ts](./demo/cache.ts)。

---

## aiOutput

`PCAgent` 增加了一个支持行动后返回答案的方法 `aiOutput`。自带的ai方法不返回最终有效信息，这个方法可以执行完操作之后返回最终的有效对话信息。

---

## 🌐 远程模式（HTTP 服务桥接）

在目标机器上启动服务，然后用 HTTP 客户端驱动：

```typescript
import "dotenv/config";
import {
  startServer,
  createRemotePCService,
  PCDevice,
  PCAgent,
} from "midscene-pc";

async function main() {
  // 测试时可以直接在本机启动服务（默认 http://0.0.0.0:3333）
  await startServer();

  // 通过 HTTP 驱动
  const pcService = createRemotePCService("http://localhost:3333");
  const device = new PCDevice({ pcService, launchOptions: {} });
  await device.launch();

  const agent = new PCAgent(device);
  await agent.aiAction("描述一下当前桌面的情况");
}

main().catch(console.error);
```

### 🐳 远程服务器安装指南

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

> **提示：** 服务默认启动在 `3333` 端口。  
> 详情可以参考 [midscene-pc-docker](https://github.com/mofangbao/midscene-pc-docker)

---

## 🎯 运行项目内示例

本仓库内置多个 demo，含本地与远程两种用法。

### 本地运行

```bash
pnpm install
pnpm dev
```

### 远程运行

```bash
# 模拟远程运行
pnpm dev --remote
```

---

## 📋 Server API 一览

| Method | Path                    | Body                    | Response            | 说明                             |
|--------|-------------------------|-------------------------|---------------------|----------------------------------|
| GET    | `/health`               | -                       | `{ ok: true }`      | 健康检查                         |
| GET    | `/monitors`             | -                       | `Monitor[]`         | 显示器列表                       |
| GET    | `/monitors/:id/capture` | -                       | `image/png`         | 指定显示器截图                   |
| POST   | `/monitor/point`        | `{ x, y }`              | `Monitor \| null`   | 点位所在显示器                   |
| GET    | `/windows`              | -                       | `Window[]`          | 窗口列表                         |
| GET    | `/windows/:id/capture`  | -                       | `image/png`         | 指定窗口截图                     |
| POST   | `/mouse/set-position`   | `{ x, y }`              | `{ success: true }` | 设置鼠标位置                     |
| GET    | `/mouse/position`       | -                       | `{ x, y }`          | 获取鼠标位置                     |
| POST   | `/mouse/click`          | `{ button }`            | `{ success: true }` | 单击（`MouseButton`）            |
| POST   | `/mouse/double-click`   | `{ button }`            | `{ success: true }` | 双击（`MouseButton`）            |
| POST   | `/mouse/press`          | `{ button }`            | `{ success: true }` | 按下（`MouseButton`）            |
| POST   | `/mouse/release`        | `{ button }`            | `{ success: true }` | 抬起（`MouseButton`）            |
| POST   | `/mouse/move`           | `{ points: Point[] }`   | `{ success: true }` | 路径移动                         |
| POST   | `/mouse/scroll/left`    | `{ distance }`          | `{ success: true }` | 水平滚动左                       |
| POST   | `/mouse/scroll/right`   | `{ distance }`          | `{ success: true }` | 水平滚动右                       |
| POST   | `/mouse/scroll/up`      | `{ distance }`          | `{ success: true }` | 垂直滚动上                       |
| POST   | `/mouse/scroll/down`    | `{ distance }`          | `{ success: true }` | 垂直滚动下                       |
| POST   | `/keyboard/press`       | `{ keys: number[] }`    | `{ success: true }` | 按下按键（`KeyCode`）            |
| POST   | `/keyboard/release`     | `{ keys: number[] }`    | `{ success: true }` | 释放按键（`KeyCode`）            |
| POST   | `/keyboard/type`        | `{ text }`              | `{ success: true }` | 输入文本                         |
| POST   | `/clipboard/set`        | `{ content }`           | `{ success: true }` | 设置剪贴板                       |
| GET    | `/clipboard/get`        | -                       | `{ content }`       | 获取剪贴板                       |
| POST   | `/screenshot`           | `{ saveFileFullPath? }` | `{ rect, monitor }` | 捕获屏幕（返回矩形与显示器信息） |

### 类型说明

- **Monitor**: `{ id, name, x, y, width, height, rotation, scaleFactor, frequency, isPrimary }`
- **Window**: `{ id, appName, title, x, y, width, height, currentMonitor: Monitor }`
- **MouseButton**、**KeyCode** 枚举以及 **Point**、**Rect** 类型来自本包导出的接口

---

## 🪟 Windows 窗口级节点应用（win-node-app）

在 Windows 桌面会话内运行一个 HTTP 服务，把整套窗口级能力开放给外部系统调用（含 Midscene AI 任务）：

```bash
# 在 Windows 机器上（桌面会话内）
npm install midscene-pc
node node_modules/midscene-pc/dist/win-node-app.js
```

环境变量：`PORT`（默认 3333）、`HOST`（默认 0.0.0.0）、`TOKEN`（可选，设置后所有请求需带 `?token=`）、`ENABLE_AI=0` 关闭 AI 端点；模型配置沿用 `.env` 的 `MIDSCENE_MODEL_*` 系列。

除了上文的内置 PC 服务接口，额外提供：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/windows` | 可见窗口列表（id/title/appName/几何） |
| GET  | `/api/windows/foreground` | 当前前台窗口句柄 |
| POST | `/api/windows/launch` | `{ exe, args }` 在桌面会话启动应用 |
| POST | `/api/windows/focus` | `{ id }` 置前窗口 |
| POST | `/api/windows/minimize` | `{ id }` 最小化窗口 |
| POST | `/api/windows/restore` | `{ id }` 恢复窗口 |
| POST | `/api/windows/close` | `{ id }` 关闭窗口（WM_CLOSE，等同点 X） |
| POST | `/api/ai/act` | `{ windowId?, task }` 在指定窗口范围内执行 AI 任务 |
| POST | `/api/ai/query` | `{ windowId?, demand }` 从窗口截图中提取结构化数据 |
| POST | `/api/ai/output` | `{ windowId?, task }` 让模型把最终答案作为结果返回（带超时） |
| POST | `/api/ai/tap` | `{ windowId?, target }` 点击窗口内目标 |
| POST | `/api/ai/input` | `{ windowId?, value, target }` 向窗口内输入框写文本 |
| POST | `/api/ai/locate` | `{ windowId?, target }` 返回目标的 center/rect |
| POST | `/api/agent/reset` | 释放所有缓存的窗口设备/代理 |
| GET  | `/api/config/model` | 查看当前模型环境变量（API key 只回显掩码） |
| POST | `/api/config/model` | 传 "values" 映射热切换模型后端 |
| POST | `/api/config/model/test` | 传 "base_url"/"api_key" 探活模型服务，不改动配置 |

`windowId`（或 `title`/`appName`）决定 AI 任务的截图与点击坐标系：模型只能看见并操作该窗口的矩形区域；省略时退化为整块主屏。

模型热配置：`POST /api/config/model` 接受 `MIDSCENE_MODEL_*`、`MIDSCENE_(INSIGHT|PLANNING)_MODEL_*`、`MIDSCENE_OPENAI_*`、`MIDSCENE_USE_*` 与 `MIDSCENE_REPLANNING_CYCLE_LIMIT`，值为 `null` 表示删除该键；默认回写 `.env`（body 里 `persist:false` 跳过回写），保存后立即生效并重建缓存的 agent，无需重启进程。白名单之外的键（如 `PATH`）一律 400 拒绝；GET 响应中 API key 只回显掩码。

调用示例（在 Chrome 里搜索中文关键词并读回结果）：

```bash
curl -X POST http://WIN:3333/api/windows/launch -H 'content-type: application/json' \\
  -d '{"exe":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","args":["--no-first-run","https://www.baidu.com/s?wd=%E6%9D%AD%E5%B7%9E%E8%A5%BF%E6%B9%96"]}'
curl http://WIN:3333/api/windows   # 从返回里找到 Chrome 窗口的 id
curl -X POST http://WIN:3333/api/ai/query -H 'content-type: application/json' \\
  -d '{"windowId":131836,"demand":"{ pageTitle: string, firstResultTitle: string }"}'
```

> Windows 上的中文输入走剪贴板粘贴（Ctrl+V），不依赖 IME，实测码点无损；截屏与输入要求进程运行在交互（桌面）会话内，SSH/服务会话拿不到有效的桌面句柄。

---

## 📄 许可证

MIT

---

## 🔗 关联链接

- [Midscene.js 官网](https://midscenejs.com/)
- [模型选择指南](https://midscenejs.com/choose-a-model)
- [核心库（@midscene/core）](https://www.npmjs.com/package/@midscene/core)
