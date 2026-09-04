import { Monitor, Window } from "node-screenshots";
import {
  AbstractMonitor,
  AbstractWindow,
  IPCService,
  PNGBuffer,
} from "../interfaces/pc.service.interface.js";
import {
  mouse as nutMouse,
  keyboard as nutKeyboard,
  clipboard as nutClipboard,
} from "@nut-tree-fork/nut-js";
import { screenshot } from "../screeshot.js";

/**
 * node-screenshots 在不同 Node 版本下把 class 成员暴露成 getter 或直接方法：
 * Node >= 20 的 napi-rs 绑定里 `monitor.id` 会是函数本身而不是值。
 * 统一用这个取值器抹平两种形态。
 */
function pick<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  const value = obj[key];
  if (typeof value === "function") {
    return (value as unknown as () => T[K]).call(obj);
  }
  return value;
}

class LocalMonitor extends AbstractMonitor {
  constructor(protected _monitor: Monitor) {
    super();
  }

  public get name(): string {
    return pick(this._monitor, "name");
  }
  public get x(): number {
    return pick(this._monitor, "x");
  }
  public get y(): number {
    return pick(this._monitor, "y");
  }
  public get width(): number {
    return pick(this._monitor, "width");
  }
  public get height(): number {
    return pick(this._monitor, "height");
  }
  public get rotation(): number {
    return pick(this._monitor, "rotation");
  }
  public get scaleFactor(): number {
    return pick(this._monitor, "scaleFactor");
  }
  public get frequency(): number {
    return pick(this._monitor, "frequency");
  }
  public get isPrimary(): boolean {
    return pick(this._monitor, "isPrimary");
  }
  public async captureImage(): Promise<PNGBuffer> {
    const image = await this._monitor.captureImage();
    return image.toPng();
  }
  public get id(): number {
    return pick(this._monitor, "id");
  }
}

class LocalWindow extends AbstractWindow {
  constructor(protected _window: Window) {
    super();
  }

  /** Unique identifier associated with the window. */
  public get id(): number {
    return pick(this._window, "id");
  }
  public get appName(): string {
    return pick(this._window, "appName");
  }
  public get title(): string {
    return pick(this._window, "title");
  }
  public get currentMonitor(): AbstractMonitor {
    return new LocalMonitor(pick(this._window, "currentMonitor"));
  }
  public get x(): number {
    return pick(this._window, "x");
  }
  public get y(): number {
    return pick(this._window, "y");
  }
  public get width(): number {
    return pick(this._window, "width");
  }
  public get height(): number {
    return pick(this._window, "height");
  }

  public async captureImage(): Promise<PNGBuffer> {
    const image = await this._window.captureImage();
    return image.toPng();
  }
}

export const localPCService: IPCService = {
  name: "LocalPCService",
  mouse: nutMouse as any,
  keyboard: nutKeyboard as any,
  clipboard: nutClipboard,
  allMonitors: () =>
    Promise.resolve(Monitor.all().map((monitor) => new LocalMonitor(monitor))),
  allWindows: () =>
    Promise.resolve(Window.all().map((window) => new LocalWindow(window))),
  getMonitorFromPoint: async (point) => {
    const monitor = Monitor.fromPoint(point.x, point.y);
    return monitor ? new LocalMonitor(monitor) : null;
  },
  screenShot: async (saveFileFullPath?: string) => {
    const res = await screenshot(saveFileFullPath);
    if (res) {
      return {
        rect: res.rect,
        monitor: res.monitor ? new LocalMonitor(res.monitor) : null,
      };
    }
    return undefined;
  },
};
