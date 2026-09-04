import { type ActionScrollParam, type DeviceAction, type InterfaceType, type LocateResultElement, type Size, z } from "@midscene/core";
import {
    type AbstractInterface,
    defineAction,
    defineActionsFromInputPrimitives,
    type InputPrimitives,
    type KeyboardInputPrimitives,
    type PointerInputPrimitives,
    type ScrollInputPrimitives,
    type TouchInputPrimitives,
} from "@midscene/core/device";
import { Jimp, JimpInstance } from "jimp";
import os from "os";
import { AbstractMonitor, AbstractWindow, IPCService, KeyCode, MouseButton, PNGBuffer } from "./interfaces/pc.service.interface.js";
import "./logger.js"; // 导入日志配置
import { straightTo } from "@nut-tree-fork/nut-js";

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type PCDeviceArea = {
    /**
     * 非手动模式或者手动模式后取消选择时生效。
     * monitorId可以先代码调用一次monitors方法获取所有显示器的信息。
     */
    monitorId?: number;
    /**
     * 第几台显示器，优先级低于monitorId。
     */
    moniterIdx?: number;
    /**
     * The area of the monitor to capture.
     * Priority lower than manual selection.
     * Coordinate relative to the specified monitorId.When no monitorId is specified,
     * the coordinate is relative to the primary monitor.
     * If not specified, the full monitor area will be captured.
     */
    area?: { x: number; y: number; width: number; height: number };
    /**
     * 是否优先让用户手动选择监控区域
     */
    preferManual?: boolean;
};

export interface PCDeviceLaunchOptions {
    /**
     * The area of the screen to capture. Lower priority than windowInfo.
     * If not specified, the full screen area of primary monitor will be captured.
     * If specified as "manual", the user will be prompted to select the screen area.
     */
    screenArea?: PCDeviceArea;
    /**
     * When the window has multiple sub-window,set only for rect to true.
     * Use windows method to get all window info.
     * All conditions are combined using AND logic.
     * Higher priority than screenArea. If specified, the windowInfo will be used to capture the specified window.
     * If none of the specified windowInfo matches, the full screen area of primary monitor will be captured.
     */
    windowInfo?: {
        /**
         * id of the window to capture.
         */
        id?: number;
        /**
         * title of the window to capture.
         */
        title?: string;
        /**
         * app name of the window to capture.
         */
        appName?: string;
        /**
         * only use rect info to capture the window.default true.
         * If the app only has one window,set it to false for performance.
         */
        onlyForRect?: boolean;
        /**
         * Is the window won't move.If true,performance will be improved,but
         * the window must be in the same position as the last time,otherwise the capture will be failed.
         * default true.
         */
        fixedWindow?: boolean;
    };
    /**
     * The full path to save the screenshot when manual mode is enabled.
     * If not specified, the screenshot will not be saved.
     */
    manualScreenshotSaveFullPath?: string;
}

export interface PCDeviceOptions {
    pcService: IPCService;
    launchOptions?: PCDeviceLaunchOptions;
    /**
     * 是否在input之前执行一次点击获取焦点操作，默认false
     */
    clickBeforeInput?: boolean;
}

export type ScreenTargetFinder = () => Promise<{
    rectInGlobal: { x: number; y: number; width: number; height: number };
    rectInMonitor: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
    captureImage: () => Promise<JimpInstance>;
}>;

interface WindowInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    scaleFactor: number;
    captureImage: () => Promise<PNGBuffer>;
    currentMonitor: AbstractMonitor;
    title: string;
    appName: string;
}

export default class PCDevice implements AbstractInterface {
    /**
     * 各类操作之后，等待操作生效的时间。主要让UI有时间进行响应，需要根据不同的应用特点来设置，默认是100ms
     */
    public static ACTION_TRANSFORM_TIME = 100;
    /**
     * 平台特定配置，表示鼠标滚动一次数量的最大值，默认1000，超过的会自动分批发送
     * 不表示像素数量，是一个相对数值
     */
    public static MOUSE_WHEEL_ONCE_MAX = 1000;
    /**
     * 平台特定配置，表示鼠标滚动一次滚动的像素数量，默认1.8，不同平台可能不同
     */
    public static MOUSE_WHEEL_TO_PIXEL = 1.6;
    private launched = false;
    interfaceType: InterfaceType = "pc";
    private options: PCDeviceOptions;
    private targetFinder: ScreenTargetFinder = undefined as any;
    private outputListeners: Map<string, ((output: string) => void)[]> = new Map();

    constructor(options?: PCDeviceOptions) {
        if (!options?.pcService) {
            throw new Error("pcService in options is required");
        }
        this.options = options;
        if (this.options.launchOptions?.windowInfo) {
            this.options.launchOptions.windowInfo.onlyForRect = this.options.launchOptions?.windowInfo?.onlyForRect ?? true;
            this.options.launchOptions.windowInfo.fixedWindow = this.options.launchOptions?.windowInfo?.fixedWindow ?? true;
        }
    }

    private async getScreenPos(regionPos: number[]) {
        const target = await this.targetFinder();
        return {
            x: regionPos[0] + target.rectInGlobal.x,
            y: regionPos[1] + target.rectInGlobal.y,
        };
    }

  private mapKeyboard(keyName: string): KeyCode | undefined {
    // 标准化输入：去除首尾空格
    const normalizedKey = keyName?.trim();
    if (!normalizedKey) {
      console.warn(`[mapKeyboard] Empty key name provided`);
      return undefined;
    }

    // 尝试直接映射（检查枚举属性）
    if (normalizedKey in KeyCode) {
      const result = (KeyCode as any)[normalizedKey] as KeyCode;
      // console.log(`[mapKeyboard] Direct mapping found: "${normalizedKey}" -> ${result}`);
      return result;
    }

    // 尝试不区分大小写的映射（针对单个字母键）
    const uppercasedKey = normalizedKey.toUpperCase();
    if (uppercasedKey in KeyCode && uppercasedKey !== normalizedKey) {
      const result = (KeyCode as any)[uppercasedKey] as KeyCode;
      // console.log(`[mapKeyboard] Case-insensitive mapping found: "${normalizedKey}" -> "${uppercasedKey}" -> ${result}`);
      return result;
    }

    // 尝试将输入转换为数字（支持直接传入数字码）
    const numericCode = parseInt(normalizedKey, 10);
    if (!isNaN(numericCode)) {
      // 检查是否是有效的 KeyCode 值
      const validValues = Object.values(KeyCode).filter(
        (v) => typeof v === "number"
      );
      if (validValues.includes(numericCode)) {
        // console.log(`[mapKeyboard] Numeric code found: "${normalizedKey}" -> ${numericCode}`);
        return numericCode as KeyCode;
      }
    }

    // 支持更多常见键盘按键名称的别名映射
    const keyAliases: Record<string, string> = {
      "Enter": "Return",
      "Ctrl": "LeftControl",
      "Control": "LeftControl",
      "Cmd": "LeftMeta",
      "Command": "LeftMeta",
      "Win": "LeftMeta",
      "Windows": "LeftMeta",
      "Alt": "LeftAlt",
      "Option": "LeftAlt",
      "Shift": "LeftShift",
      "Space": "Space",
      "Tab": "Tab",
      "Esc": "Escape",
      "Up": "Up",
      "Down": "Down",
      "Left": "Left",
      "Right": "Right",
      "Delete": "Delete",
      "Del": "Delete",
      "Backspace": "Backspace",
      "CapsLock": "CapsLock",
    };

    const mappedName = keyAliases[normalizedKey];
    if (mappedName && mappedName in KeyCode) {
      const result = (KeyCode as any)[mappedName] as KeyCode;
      // console.log(`[mapKeyboard] Alias mapping found: "${normalizedKey}" -> "${mappedName}" -> ${result}`);
      return result;
    }

    console.warn(`[mapKeyboard] Key "${normalizedKey}" not found in KeyCode enum`);
    // console.log(`[mapKeyboard] Available keys: ${Object.keys(KeyCode).filter(k => isNaN(Number(k))).join(', ')}`);
    return undefined;
  }

    private async typeText(text: string) {
        const platform = os.platform(); // 'win32' | 'darwin' | 'linux' | ...
        // 安全设置剪贴板
        await this.options.pcService.clipboard.setContent(text);

        switch (platform) {
            case "win32":
                // Windows: Ctrl+V
                await this.pressKey(KeyCode.LeftControl, KeyCode.V);
                break;

            case "darwin":
                // macOS: Command+V
                await this.pressKey(KeyCode.LeftCmd, KeyCode.V);
                break;

            case "linux":
                // Linux 常见两种方式：
                // 1️⃣ 用 nutjs 模拟 Ctrl+V
                await this.pressKey(KeyCode.LeftControl, KeyCode.V);
                break;

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    private async findWindow(): Promise<WindowInfo> {
        const windows = await this.windows();
        const targetWindow = windows.find((w) => {
            const idMatch = !this.options.launchOptions?.windowInfo?.id || w.id === this.options.launchOptions?.windowInfo?.id;
            const titleMatch = !this.options.launchOptions?.windowInfo?.title || w.title.includes(this.options.launchOptions?.windowInfo?.title);
            const appNameMatch = !this.options.launchOptions?.windowInfo?.appName || w.appName.includes(this.options.launchOptions?.windowInfo?.appName);
            return idMatch && titleMatch && appNameMatch;
        });
        if (!targetWindow) {
            return undefined as any;
        }
        return {
            x: Math.max(targetWindow.currentMonitor.x, targetWindow.x),
            y: Math.max(targetWindow.currentMonitor.y, targetWindow.y),
            width: Math.min(targetWindow.width, targetWindow.currentMonitor.width),
            height: Math.min(targetWindow.height, targetWindow.currentMonitor.height),
            scaleFactor: targetWindow.currentMonitor.scaleFactor,
            captureImage: async () => {
                const image = await targetWindow.captureImage();
                return image;
            },
            currentMonitor: targetWindow.currentMonitor,
            title: targetWindow.title,
            appName: targetWindow.appName,
        };
    }

    private async clearInput(pos: { x: number; y: number }, newData?: string) {
        await this.options.pcService.mouse.setPosition({ x: pos.x, y: pos.y });
        await this.options.pcService.mouse.click(MouseButton.LEFT);
        await this.options.pcService.mouse.click(MouseButton.LEFT);
        await this.options.pcService.mouse.click(MouseButton.LEFT);
        await this.typeText(newData ?? "");
    }

    private async mousewheel(direction: "scrollUp" | "scrollDown" | "scrollLeft" | "scrollRight", pixel: number) {
        const distance = pixel * PCDevice.MOUSE_WHEEL_TO_PIXEL;
        if (distance <= PCDevice.MOUSE_WHEEL_ONCE_MAX) {
            await this.options.pcService.mouse[direction](distance);
            return;
        } else {
            let passDistance = 0;
            while (passDistance < Math.abs(distance)) {
                passDistance += PCDevice.MOUSE_WHEEL_ONCE_MAX;
                await this.options.pcService.mouse[direction](Math.min(PCDevice.MOUSE_WHEEL_ONCE_MAX, Math.abs(distance) - passDistance));
                await sleep(50);
            }
        }
    }

    private async pressKey(...keys: KeyCode[]) {
        await this.options.pcService.keyboard.pressKey(...keys);
        await this.options.pcService.keyboard.releaseKey(...keys);
    }

    public hasLaunched(): boolean {
        return this.launched;
    }

    // this is not required by AbstractInterface
    public async launch(): Promise<void> {
        if (this.launched) {
            console.warn("PCDevice already launched, skip");
            return;
        }
        console.log("launching pc device");
        this.launched = true;
        if (this.options.launchOptions?.windowInfo?.appName || this.options.launchOptions?.windowInfo?.title || this.options.launchOptions?.windowInfo?.id) {
            // try use window info
            const targetWindow = await this.findWindow();
            if (targetWindow) {
                const generateTargetInfo = (currentTargetWindow: WindowInfo): ReturnType<ScreenTargetFinder> => {
                    return Promise.resolve({
                        rectInGlobal: {
                            x: currentTargetWindow.x,
                            y: currentTargetWindow.y,
                            width: currentTargetWindow.width,
                            height: currentTargetWindow.height,
                        },
                        rectInMonitor: {
                            x: currentTargetWindow.x - currentTargetWindow.currentMonitor.x,
                            y: currentTargetWindow.y - currentTargetWindow.currentMonitor.y,
                            width: currentTargetWindow.currentMonitor.width,
                            height: currentTargetWindow.currentMonitor.height,
                        },
                        scaleFactor: currentTargetWindow.currentMonitor.scaleFactor,
                        captureImage: async () => {
                            let instance: JimpInstance;
                            if (this.options.launchOptions?.windowInfo?.onlyForRect === false) {
                                const image = await currentTargetWindow.captureImage();
                                instance = (await Jimp.fromBuffer(image)) as any;
                            } else {
                                const image = await currentTargetWindow.currentMonitor.captureImage();
                                instance = (await Jimp.fromBuffer(image)) as any;
                                instance = (await instance.crop({
                                    x: currentTargetWindow.x - currentTargetWindow.currentMonitor.x,
                                    y: currentTargetWindow.y - currentTargetWindow.currentMonitor.y,
                                    w: currentTargetWindow.width,
                                    h: currentTargetWindow.height,
                                })) as any;
                            }
                            return instance;
                        },
                    });
                };
                if (this.options.launchOptions?.windowInfo?.fixedWindow) {
                    this.targetFinder = async () => generateTargetInfo(targetWindow);
                } else {
                    this.targetFinder = async () => {
                        const currentTargetWindow = await this.findWindow();
                        if (!currentTargetWindow) {
                            throw new Error(
                                `Window:\n ${
                                    this.options.launchOptions?.windowInfo?.appName ??
                                    this.options.launchOptions?.windowInfo?.title ??
                                    this.options.launchOptions?.windowInfo?.id
                                }\n not found`,
                            );
                        }
                        return generateTargetInfo(currentTargetWindow);
                    };
                }
                console.debug(`Window ${targetWindow.title} found, use it as screenshot target`);
                return;
            } else {
                console.warn(`Window:\n ${JSON.stringify(this.options.launchOptions?.windowInfo)}\n not found, try use areainfo instead`);
            }
        } else {
            let targetMonitor: AbstractMonitor = undefined as any;
            let area: { x: number; y: number; width: number; height: number } = this.options.launchOptions?.screenArea?.area as any;
            if (this.options.launchOptions?.screenArea?.preferManual) {
                // prompt user to select the screen area
                const areaInfo = await this.options.pcService.screenShot(this.options.launchOptions?.manualScreenshotSaveFullPath);
                if (areaInfo?.monitor) {
                    targetMonitor = areaInfo.monitor;
                    if (areaInfo.rect) {
                        area = areaInfo.rect;
                    }
                    console.debug(`Screen selected`);
                } else {
                    console.warn("user stop select screen area, use primary monitor instead");
                }
            }
            if (!targetMonitor) {
                const allMonitors = await this.monitors();
                if (!allMonitors.length) {
                    throw new Error("No monitors found");
                }
                const targetMonitorId = this.options.launchOptions?.screenArea?.monitorId;
                if (targetMonitorId) {
                    targetMonitor = allMonitors.find((m) => m.id === targetMonitorId) as any;
                }
                if (!targetMonitor && this.options.launchOptions?.screenArea?.moniterIdx !== undefined) {
                    targetMonitor = allMonitors[Math.min(Math.max(this.options.launchOptions?.screenArea?.moniterIdx ?? 0, 0), allMonitors.length - 1)];
                } else {
                    targetMonitor = allMonitors.find((m) => m.isPrimary) ?? allMonitors[0];
                }
            }
            console.debug(`Monitor x:${targetMonitor.x}, y:${targetMonitor.y}, width:${targetMonitor.width}, height:${targetMonitor.height}`);
            const finalArea = area || {
                x: 0,
                y: 0,
                width: targetMonitor.width,
                height: targetMonitor.height,
            };
            // 转换为全局坐标，方便执行action时进行坐标转换
            const areaToGlobal = {
                ...finalArea,
                x: finalArea.x + targetMonitor.x,
                y: finalArea.y + targetMonitor.y,
            };
            this.targetFinder = async () => {
                return {
                    rectInGlobal: areaToGlobal,
                    rectInMonitor: finalArea,
                    scaleFactor: targetMonitor.scaleFactor,
                    captureImage: async () => {
                        let image = await targetMonitor.captureImage();
                        if (area) {
                            let jimImage = await Jimp.fromBuffer(image);
                            // 这里使用屏幕的坐标来裁剪，而不是全局坐标
                            jimImage = (await jimImage.crop({
                                x: area.x,
                                y: area.y,
                                w: area.width,
                                h: area.height,
                            })) as any;
                            return jimImage;
                        } else {
                            return (await Jimp.fromBuffer(image)) as any;
                        }
                    },
                };
            };
        }
    }

    public async click(element: LocateResultElement) {
        if (element?.center) {
            const screenPos = await this.getScreenPos(element.center);
            await this.options.pcService.mouse.setPosition(screenPos);
            await this.options.pcService.mouse.click(MouseButton.LEFT);
            await sleep(PCDevice.ACTION_TRANSFORM_TIME);
        } else {
            console.warn(`Element ${element} not found, skip tap`);
        }
    }

    // ===== Midscene >= 1.10 input primitives =====
    // 新版 core 不再接受旧式 defineActionTap(param) 回调，而是要求设备暴露
    // Pointer/Keyboard/Scroll/Touch 四类原语，action 空间由 core 统一组装。
    // 原语入参坐标是当前截图区域内的坐标，这里统一换算成全局屏幕坐标。
    private get pointerPrimitives(): NonNullable<InputPrimitives["pointer"]> {
        return {
            tap: async (p) => {
                const pos = await this.getScreenPos([p.x, p.y]);
                await this.options.pcService.mouse.setPosition(pos);
                await this.options.pcService.mouse.click(MouseButton.LEFT);
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
            doubleClick: async (p) => {
                const pos = await this.getScreenPos([p.x, p.y]);
                await this.options.pcService.mouse.setPosition(pos);
                await this.options.pcService.mouse.doubleClick(MouseButton.LEFT);
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
            rightClick: async (p) => {
                const pos = await this.getScreenPos([p.x, p.y]);
                await this.options.pcService.mouse.setPosition(pos);
                await this.options.pcService.mouse.click(MouseButton.RIGHT);
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
            hover: async (p) => {
                const pos = await this.getScreenPos([p.x, p.y]);
                await this.options.pcService.mouse.setPosition(pos);
                await sleep(2000);
            },
            longPress: async (p, opts) => {
                const pos = await this.getScreenPos([p.x, p.y]);
                await this.options.pcService.mouse.setPosition(pos);
                await this.options.pcService.mouse.pressButton(MouseButton.LEFT);
                await sleep(opts?.duration ?? 2000);
                await this.options.pcService.mouse.releaseButton(MouseButton.LEFT);
            },
            dragAndDrop: async (from, to) => {
                const fromPos = await this.getScreenPos([from.x, from.y]);
                await this.options.pcService.mouse.setPosition(fromPos);
                await this.options.pcService.mouse.pressButton(MouseButton.LEFT);
                const toPos = await this.getScreenPos([to.x, to.y]);
                await this.options.pcService.mouse.move(await straightTo(toPos));
                await this.options.pcService.mouse.releaseButton(MouseButton.LEFT);
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
        };
    }

    private get keyboardPrimitives(): KeyboardInputPrimitives {
        return {
            keyboardPress: async (keyName, opts) => {
                const target = opts?.target as LocateResultElement | undefined;
                if (target?.center) {
                    const pos = await this.getScreenPos(target.center);
                    await this.options.pcService.mouse.setPosition(pos);
                    await this.options.pcService.mouse.click(MouseButton.LEFT);
                    await sleep(PCDevice.ACTION_TRANSFORM_TIME);
                }
                if (keyName.includes("+")) {
                    const keys = keyName.split("+").map((k) => this.mapKeyboard(k));
                    if (keys.includes(undefined)) {
                        throw new Error(`Key ${keyName} not found`);
                    }
                    await this.pressKey(...(keys as KeyCode[]));
                } else {
                    const nutKey = this.mapKeyboard(keyName);
                    if (!nutKey) {
                        throw new Error(`Key ${keyName} not found`);
                    }
                    await this.pressKey(nutKey);
                }
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
            typeText: async (value, opts) => {
                const target = opts?.target as LocateResultElement | undefined;
                if (!target?.center) {
                    console.error(`Element ${JSON.stringify(target)} not found`);
                    await this.typeText(value);
                    await sleep(PCDevice.ACTION_TRANSFORM_TIME);
                    return;
                }
                const pos = await this.getScreenPos(target.center);
                if (opts?.replace) {
                    await this.clearInput(pos, value);
                } else {
                    await this.options.pcService.mouse.setPosition(pos);
                    if (this.options.clickBeforeInput) {
                        await this.options.pcService.mouse.click(MouseButton.LEFT);
                        await sleep(PCDevice.ACTION_TRANSFORM_TIME);
                    }
                    await this.typeText(value);
                }
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
            clearInput: async (target) => {
                const element = target as LocateResultElement | undefined;
                if (element?.center) {
                    const pos = await this.getScreenPos(element.center);
                    await this.clearInput(pos);
                } else {
                    console.warn("Element not found, skip clear input");
                }
            },
        };
    }

    private get scrollPrimitives(): ScrollInputPrimitives {
        return {
            scroll: async (param: ActionScrollParam) => {
                const element = param.locate;
                if (element?.center) {
                    const pos = await this.getScreenPos(element.center as number[]);
                    await this.options.pcService.mouse.setPosition(pos);
                    await sleep(PCDevice.ACTION_TRANSFORM_TIME);
                }
                const scrollType = (param as { scrollType?: string }).scrollType;
                if (scrollType && scrollType !== "singleAction") {
                    switch (scrollType) {
                        case "scrollToBottom":
                            await this.pressKey(KeyCode.LeftControl, KeyCode.End);
                            break;
                        case "scrollToTop":
                            await this.pressKey(KeyCode.LeftControl, KeyCode.Home);
                            break;
                        case "scrollToLeft":
                            await this.mousewheel("scrollLeft", 20000);
                            break;
                        case "scrollToRight":
                            await this.mousewheel("scrollRight", 20000);
                            break;
                    }
                } else {
                    switch (param.direction) {
                        case "left":
                            await this.mousewheel("scrollLeft", param.distance ?? 500);
                            break;
                        case "right":
                            await this.mousewheel("scrollRight", param.distance ?? 500);
                            break;
                        case "down":
                            await this.mousewheel("scrollDown", param.distance ?? 500);
                            break;
                        case "up":
                            await this.mousewheel("scrollUp", param.distance ?? 500);
                            break;
                    }
                }
            },
        };
    }

    private get touchPrimitives(): TouchInputPrimitives {
        return {
            swipe: async (start, end, opts) => {
                const startPos = await this.getScreenPos([start.x, start.y]);
                await this.options.pcService.mouse.setPosition(startPos);
                const dy = end.y - start.y;
                const dx = end.x - start.x;
                // 桌面滚轮方向与手指滑动方向相反：手指上滑 = 内容向下滚动
                if (Math.abs(dy) >= Math.abs(dx)) {
                    if (dy < 0) await this.mousewheel("scrollDown", Math.abs(dy));
                    else await this.mousewheel("scrollUp", Math.abs(dy));
                } else {
                    if (dx < 0) await this.mousewheel("scrollRight", Math.abs(dx));
                    else await this.mousewheel("scrollLeft", Math.abs(dx));
                }
                await sleep(PCDevice.ACTION_TRANSFORM_TIME);
            },
        };
    }

    /**
     * 设备支持的操作空间（由四类输入原语组装，兼容 Midscene >= 1.10）
     */
    public actionSpace(): DeviceAction<any>[] {
        const primitiveActions = defineActionsFromInputPrimitives(
            {
                pointer: this.pointerPrimitives,
                keyboard: this.keyboardPrimitives,
                scroll: this.scrollPrimitives,
                touch: this.touchPrimitives,
            },
            { size: () => this.size(), sleep },
        );
        return [
            ...primitiveActions,
            defineAction({
                name: "OutputFinalAnwser",
                description: "针对用户的提问，输出最后总结整理好的回答内容。仅当用户原始问题需要输出最终答案时采需要调用。",
                interfaceAlias: "aiOutputFinalAnwser",
                paramSchema: z.object({
                    value: z.string().describe("The final answer to output"),
                    uuid: z.string().describe("The unique id of the output listener，如果用户提供了，务必原样输出，否则可以自定义"),
                }),
                call: async (param: { value: string; uuid: string }) => {
                    if (!param.uuid?.length) {
                        console.debug(`Output listener uuid not provided, skip output`);
                        return;
                    }
                    const listeners = this.outputListeners.get(param.uuid);
                    if (!listeners?.length) {
                        console.debug(`Output listener ${param.uuid} not found, skip output`);
                        return;
                    }
                    listeners!.forEach((listener) => listener(param.value));
                },
            }),
        ];
    }

    public listenOutput(id: string, callback: (output: string) => void) {
        if (this.outputListeners.has(id)) {
            this.outputListeners.get(id)!.push(callback);
        } else {
            this.outputListeners.set(id, [callback]);
        }
        return id;
    }

    public removeOutputListener(id: string, callback: (output: string) => void) {
        if (this.outputListeners.has(id)) {
            this.outputListeners.set(
                id,
                this.outputListeners.get(id)!.filter((listener) => listener !== callback),
            );
        }
        if (this.outputListeners.get(id)!.length === 0) {
            this.outputListeners.delete(id);
        }
    }

    /**
     * 设备描述
     */
    public describe(): string {
        return `This is a pc device for Midscene`;
    }

    /**
     * 设备屏幕大小
     */
    public async size(): Promise<Size> {
        const targetInfo = await this.targetFinder();
        return {
            width: targetInfo.rectInGlobal.width,
            height: targetInfo.rectInGlobal.height,
        };
    }

    /**
     * 设备屏幕截图
     */
    public async screenshotBase64(): Promise<string> {
        const targetInfo = await this.targetFinder();
        let screenshot = await targetInfo.captureImage();
        const base64Image = await screenshot.getBase64("image/png");
        return base64Image;
    }

    /**
     * 设备支持的显示器
     */
    public async monitors(): Promise<AbstractMonitor[]> {
        return await this.options.pcService.allMonitors();
    }

    /**
     * 设备支持的窗口
     */
    public async windows(): Promise<AbstractWindow[]> {
        return await this.options.pcService.allWindows();
    }

    /**
     * 设备销毁
     */
    public async destroy(): Promise<void> {
        this.outputListeners.clear();
        console.log("device destroyed");
    }
}
