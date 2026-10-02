// VNCDevice: a midscene-compatible device speaking RFB over noVNC websockify,
// so ComputerAgent (aiTap/aiQuery/aiScroll/aiKeyboardPress) runs WITHOUT RDP.
//
// @midscene/computer 1.12.2 ships only ComputerDevice(local)/RDPDevice, but Agent
// takes any AbstractInterface: interfaceType, screenshotBase64, size, actionSpace,
// inputPrimitives. VNC adds zero infra (no rdp-helper/FreeRDP3/Xvfb) and never
// steals the console, so observation and control share ONE channel (AGENTS.md 1.3).
//
// RFB facts already proven by the skill's python tools (vnc_shot.py/vnc_ptr.py):
//  - PointerEvent is exactly 6 bytes: type5, mask, x u16, y u16. No reserved bytes.
//  - Drain ServerInit's name string before any client message.
//  - Wheel = mask bits 3/4 (0x08 up, 0x10 down); never AND the mask with 7.
//  - Server default pixel format arrives as BGRA byte order on the wire; swap at
//    PNG build time instead of trusting SetPixelFormat endianness.
//
import { defineActionsFromInputPrimitives } from '@midscene/core/device';
import { ComputerAgent } from '@midscene/computer';
import sharp from 'sharp';
import zlib from 'node:zlib';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEYS: Record<string, number> = {
  enter: 0xff0d, return: 0xff0d, tab: 0xff09, escape: 0xff1b, esc: 0xff1b,
  backspace: 0xff08, delete: 0xffff, del: 0xffff, insert: 0xff63,
  home: 0xff50, end: 0xff57, pageup: 0xff55, pagedown: 0xff56,
  arrowleft: 0xff51, arrowup: 0xff52, arrowright: 0xff53, arrowdown: 0xff54,
  space: 0x20,
  shift: 0xffe1, control: 0xffe3, ctrl: 0xffe3, alt: 0xffe9, option: 0xffe9,
  // Windows/QEMU maps Super_L (0xffeb) to the Win key; Meta_L is 0xffe7.
  meta: 0xffe7, super: 0xffeb, win: 0xffeb, windows: 0xffeb, cmd: 0xffeb,
  f1: 0xffbe, f2: 0xffbf, f3: 0xffc0, f4: 0xffc1, f5: 0xffc2, f6: 0xffc3,
  f7: 0xffc4, f8: 0xffc5, f9: 0xffc6, f10: 0xffc7, f11: 0xffc8, f12: 0xffc9,
};

const EXT_CLIPBOARD_ENCODING = 0xc0a1e5ce;
const EXT_ACTION_CAPS = 1 << 24;
const EXT_ACTION_REQUEST = 1 << 25;
const EXT_ACTION_NOTIFY = 1 << 27;
const EXT_ACTION_PROVIDE = 1 << 28;
const EXT_FORMAT_TEXT = 1;

function keysymFor(token: string): number {
  const k = KEYS[token.toLowerCase()];
  if (k !== undefined) return k;
  const cp = Array.from(token)[0]?.codePointAt(0);
  if (cp === undefined) throw new Error('unknown key: ' + token);
  if (cp === 0x0a) return KEYS.enter;
  if (cp >= 0x20 && cp < 0x7f) return cp;
  return 0x01000000 + cp; // X11 Unicode keysym
}

export class VNCDevice {
  interfaceType = 'vnc';
  inputPrimitives: any;

  private ws: any = null;
  private buf = Buffer.alloc(0);
  private waiters: Array<{ n: number; resolve: () => void }> = [];
 private fb = new Uint8Array(0);
 private _w = 0;
 private _h = 0;
  private cursor = { x: 0, y: 0 };
  private destroyed = false;
  private parsing = false;
  // Gate the server-message pump on connect() finishing. Without it the parser
  // runs in the microtask gap between take(24) and take(nameLen) and reads
  // the name string as a message type: Q of QEMU (Windows) = 81.
  private ready = false;
  private shotWait: { remaining: number; resolve: () => void; reject: (e: any) => void; timer: any } | null = null;
  private clipboardServerCaps = false;
  private clipboardText: string | null = null;
  private clipboardProvided: null | { resolve: () => void; timer: any } = null;

  constructor(private opts: { wsUrl: string }) {
    const dev = this;
    this.inputPrimitives = {
      pointer: {
        tap: async ({ x, y }: any) => { await dev.moveAndButton(1, x, y); },
        doubleClick: async ({ x, y }: any) => {
          await dev.moveAndButton(1, x, y, 25);
          await sleep(50);
          await dev.moveAndButton(1, x, y, 25);
        },
        // RFB PointerEvent 掩码：bit0=1 左键、bit1=2 中键、bit2=4 右键。此前发 2 是中键，
        // 微信消息上右键从未弹出菜单（2026-09-30/10-01 resdown 删卡功能实证）。
        rightClick: async ({ x, y }: any) => { await dev.moveAndButton(4, x, y); },
        hover: async ({ x, y }: any) => { dev.ptrEvent(0, x, y); await sleep(120); },
        dragAndDrop: async (from: any, to: any) => {
          dev.ptrEvent(0, from.x, from.y);
          await sleep(30);
          dev.ptrEvent(1, from.x, from.y);
          await sleep(120);
          const steps = 12;
          for (let i = 1; i <= steps; i++) {
            dev.ptrEvent(1, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
            await sleep(12);
          }
          await sleep(80);
          dev.ptrEvent(0, to.x, to.y);
          await sleep(60);
        },
      },
      keyboard: {
        keyboardPress: async (keyName: string) => { dev.assertConnected(); await dev.pressCombo(keyName); },
        typeText: async (value: string, opts: any) => {
          dev.assertConnected();
          if (opts?.target) await dev.moveAndButton(1, opts.target.center[0], opts.target.center[1]);
          if (opts?.replace !== false) {
            await dev.pressCombo('Control+a');
            await dev.pressCombo('Delete');
          }
          if (opts?.focusOnly || !value) return;
          for (const ch of value) {
            await dev.pressKeysym(keysymFor(ch));
            await sleep(12);
          }
        },
        clearInput: async (target: any) => {
          dev.assertConnected();
          if (target) await dev.moveAndButton(1, target.center[0], target.center[1]);
          await dev.pressCombo('Control+a');
          await dev.pressCombo('Delete');
        },
      },
      scroll: {
        scroll: async (param: any) => {
          dev.assertConnected();
          const cx = param?.locate?.center?.[0] ?? Math.round(dev._w / 2);
          const cy = param?.locate?.center?.[1] ?? Math.round(dev._h / 2);
          const notches = Math.max(1, Math.round((param?.distance ?? 600) / 60));
          const bit = param?.direction === 'up' ? 0x08 : 0x10;
          for (let i = 0; i < notches; i++) {
            dev.ptrEvent(bit, cx, cy);
            await sleep(12);
            dev.ptrEvent(0, cx, cy);
            await sleep(12);
          }
          await sleep(150);
        },
      },
    };
  }

  describe() {
    return 'VNC Device ' + this.opts.wsUrl + ' [' + this._w + 'x' + this._h + ']';
  }

  async connect() {
    this.ws = new WebSocket(this.opts.wsUrl, ['binary']);
    this.ws.binaryType = 'arraybuffer';
    await new Promise<void>((res, rej) => {
      this.ws.addEventListener('open', () => res(), { once: true });
      this.ws.addEventListener('error', (e: any) => rej(new Error('vnc ws error: ' + (e.message || e.type))), { once: true });
    });
    this.ws.addEventListener('message', (e: any) => {
      this.buf = Buffer.concat([this.buf, Buffer.from(e.data)]);
      this.pumpWaiters();
      // Same swallow-as-destroyed policy as connect(): a rejection here would be
      // an unhandled promise rejection and kill the process.
      if (this.ready) this.pumpServerMessages().catch(() => { /* destroyed */ });
    });

    const ver = (await this.take(12)).toString('latin1').trim();
    if (!ver.startsWith('RFB 003.')) throw new Error('unexpected RFB greeting: ' + JSON.stringify(ver));
    this.send(Buffer.from('RFB 003.008\n', 'latin1'));
    const nTypes = (await this.take(1))[0];
    const types = Array.from(await this.take(nTypes));
    if (!types.includes(1)) throw new Error('server offers no security-type None: ' + types.join(','));
    this.send(Buffer.from([1]));
    if (ver >= 'RFB 003.008') {
      const code = (await this.take(4)).readUInt32BE(0);
      if (code !== 0) throw new Error('handshake failed, security result ' + code);
    }
    // ClientInit: the shared-flag byte. This QEMU behaves RFB-3.7-style and holds
    // ServerInit back until it arrives -- omit it and connect() hangs forever on
    // take(24). (The proven vnc_shot.py sends the same 0x01 here.)
    this.send(Buffer.from([1]));
    const init = await this.take(24);
    this._w = init.readUInt16BE(0);
    this._h = init.readUInt16BE(2);
    const nameLen = init.readUInt32BE(20);
    if (nameLen > 0) await this.take(nameLen);
    this.fb = new Uint8Array(this._w * this._h * 4);
    this.cursor = { x: Math.floor(this._w / 2), y: Math.floor(this._h / 2) };
    this.ready = true;
    // Enable QEMU+vdagent Extended Clipboard. A standard ClientCutText is
    // accepted on the wire but does not reach the Windows clipboard on this stack.
    // Match the proven QEMU/vdagent push client: declare only the clipboard
    // pseudo-encoding. QEMU still serves raw rectangles for FBUR.
    this.sendSetEncodings([EXT_CLIPBOARD_ENCODING]);
    this.sendExtendedClipboardCaps();
    this.pumpServerMessages().catch(() => { /* destroyed */ });
  }

  async size() {
    this.assertConnected();
    return { width: this._w, height: this._h };
  }

  async screenshotBase64(): Promise<string> {
    this.assertConnected();
    const fbur = Buffer.alloc(10);
    fbur[0] = 3; fbur[1] = 0; // FramebufferUpdateRequest, incremental=0
    fbur.writeUInt16BE(0, 2); fbur.writeUInt16BE(0, 4);
    fbur.writeUInt16BE(this._w, 6); fbur.writeUInt16BE(this._h, 8);
    await new Promise<void>((resolve, reject) => {
      this.shotWait = {
        remaining: this._w * this._h,
        resolve: () => resolve(),
        reject: (e) => reject(e),
        timer: setTimeout(() => { this.shotWait = null; reject(new Error('framebuffer update timed out')); }, 15000),
      };
      this.send(fbur);
    });
    await sleep(120); // let trailing rects of the same refresh land
    // Wire order is BGRA (little-endian u32: B | G<<8 | R<<16 | X<<24); convert to
    // RGBA bytes R | G<<8 | B<<16 | FF<<24 in one pass.
    const out = new Uint8Array(this.fb.length);
    for (let i = 0; i < this.fb.length; i += 4) {
      out[i] = this.fb[i + 2];
      out[i + 1] = this.fb[i + 1];
      out[i + 2] = this.fb[i];
      out[i + 3] = 255;
    }
    const png = await sharp(out, { raw: { width: this._w, height: this._h, channels: 4 } }).png().toBuffer();
    return 'data:image/png;base64,' + png.toString('base64');
  }

  actionSpace() {
    return defineActionsFromInputPrimitives(this.inputPrimitives);
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.ws?.close(); } catch (e) { /* ignore */ }
  }

 // ---------- input ----------

 private ptrEvent(mask: number, x: number, y: number) {
    const cx = Math.max(0, Math.min(this._w - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this._h - 1, Math.round(y)));
    const m = Buffer.alloc(6);
    m[0] = 5; m[1] = mask & 0xff;
    m.writeUInt16BE(cx, 2); m.writeUInt16BE(cy, 4);
   this.send(m);
 }

  // Public RDP-compatible primitives. Keeping them one level below
  // inputPrimitives lets VNCRDPBackendClient implement the same backend contract
  // as @midscene/computer's native rdp-helper, without a second parser.
  async rdpMouseMove(x: number, y: number) {
    this.assertConnected();
    this.ptrEvent(0, x, y);
    this.cursor = { x: Math.max(0, Math.min(this._w - 1, Math.round(x))), y: Math.max(0, Math.min(this._h - 1, Math.round(y))) };
    await sleep(20);
  }

  async rdpMouseButton(button: 'left' | 'right' | 'middle', action: 'down' | 'up' | 'click' | 'doubleClick') {
    this.assertConnected();
    // 同上：RFB 标准 1=左 2=中 4=右；旧映射 right→2 实际发的是中键。
    const mask = button === 'left' ? 1 : button === 'right' ? 4 : 2;
    const { x, y } = this.cursor;
    if (action === 'down') { this.ptrEvent(mask, x, y); await sleep(15); return; }
    if (action === 'up') { this.ptrEvent(0, x, y); await sleep(15); return; }
    if (action === 'doubleClick') {
      await this.moveAndButton(mask, x, y, 28);
      await sleep(45);
      await this.moveAndButton(mask, x, y, 28);
      return;
    }
    await this.moveAndButton(mask, x, y);
  }

  async rdpWheel(direction: 'up' | 'down' | 'left' | 'right', amount: number, x?: number, y?: number) {
    this.assertConnected();
    const px = x ?? this.cursor.x;
    const py = y ?? this.cursor.y;
    const bit = direction === 'up' ? 0x08 : direction === 'down' ? 0x10 : direction === 'left' ? 0x20 : 0x40;
    const notches = Math.max(1, Math.round(amount / 120));
    for (let i = 0; i < notches; i++) {
      this.ptrEvent(bit, px, py);
      await sleep(12);
      this.ptrEvent(0, px, py);
      await sleep(12);
    }
  }

  async rdpKeyPress(keyName: string) {
    this.assertConnected();
    await this.pressCombo(keyName);
  }

  async rdpTypeText(text: string) {
    this.assertConnected();
    for (const ch of text) {
      if (ch >= 'A' && ch <= 'Z') {
        // QEMU's VNC keyboard translation honours case-sensitive Latin-1
        // keysyms directly; synthesising Shift here only produces lowercase.
        await this.pressKeysym(ch.charCodeAt(0));
      } else {
        await this.pressKeysym(keysymFor(ch));
      }
      await sleep(12);
    }
  }

  async rdpClearInput() {
    this.assertConnected();
    await this.pressCombo('Control+a');
    await this.pressCombo('Delete');
  }

  // QEMU+vdagent uses RFB Extended Clipboard. Standard ClientCutText is
  // accepted on this wire but does not populate Windows' clipboard, so
  // setClipboard() runs the proven Caps -> Notify -> Request -> Provide flow.
  async setClipboard(text: string) {
    this.assertConnected();
    this.clipboardText = text;
    if (this.clipboardProvided) return; // another provide is already in flight
    if (this.clipboardServerCaps) this.sendExtendedClipboardNotify();
    await new Promise<void>((resolve) => {
      this.clipboardProvided = {
        resolve,
        timer: setTimeout(() => {
          if (this.clipboardProvided?.resolve === resolve) {
            this.clipboardProvided = null;
          }
          resolve();
        }, 6000),
      };
    });
    // vdagent applies the provided blob to Windows asynchronously.
    await sleep(4000);
  }

  private sendSetEncodings(encodings: number[]) {
    const msg = Buffer.alloc(4 + encodings.length * 4);
    msg[0] = 2;
    msg.writeUInt16BE(encodings.length, 2);
    encodings.forEach((enc, i) => msg.writeUInt32BE(enc >>> 0, 4 + i * 4));
    this.send(msg);
  }

  private sendExtendedClipboard(payload: Buffer) {
    const msg = Buffer.alloc(8 + payload.length);
    msg[0] = 6;
    msg.writeInt32BE(-payload.length, 4);
    payload.copy(msg, 8);
    this.send(msg);
  }

  private flags(action: number, formats = 0) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE((action | formats) >>> 0, 0);
    return b;
  }

  private sendExtendedClipboardCaps() {
    const payload = Buffer.alloc(8);
    const clientActions = EXT_ACTION_CAPS | EXT_ACTION_REQUEST | (1 << 26) | EXT_ACTION_NOTIFY | EXT_ACTION_PROVIDE;
    this.flags(clientActions, EXT_FORMAT_TEXT).copy(payload, 0);
    payload.writeUInt32BE(0, 4); // text maximum size
    this.sendExtendedClipboard(payload);
  }

  private sendExtendedClipboardNotify() {
    if (this.clipboardText !== null) this.sendExtendedClipboard(this.flags(EXT_ACTION_NOTIFY, EXT_FORMAT_TEXT));
  }

  private sendExtendedClipboardProvide(text: string) {
    const utf8 = Buffer.from(text + '\u0000', 'utf8');
    const raw = Buffer.alloc(4 + utf8.length);
    raw.writeUInt32BE(utf8.length, 0);
    utf8.copy(raw, 4);
    const deflated = zlib.deflateSync(raw);
    const payload = Buffer.alloc(4 + deflated.length);
    this.flags(EXT_ACTION_PROVIDE, EXT_FORMAT_TEXT).copy(payload, 0);
    deflated.copy(payload, 4);
    this.sendExtendedClipboard(payload);
    const waiter = this.clipboardProvided;
    if (waiter) {
      clearTimeout(waiter.timer);
      this.clipboardProvided = null;
      waiter.resolve();
    }
  }

  private handleServerCutText(len: number) {
    if (len < 0) {
      const payload = this.takeSync(-len);
      if (payload.length < 4) return;
      const action = payload.readUInt32BE(0);
      if (action & EXT_ACTION_CAPS) {
        this.clipboardServerCaps = true;
        this.sendExtendedClipboardCaps();
        this.sendExtendedClipboardNotify();
      } else if (action & EXT_ACTION_REQUEST) {
        if (this.clipboardText !== null) this.sendExtendedClipboardProvide(this.clipboardText);
      }
      return;
    }
    this.takeSync(len);
  }

  private async moveAndButton(mask: number, x: number, y: number, holdMs = 40) {
    this.assertConnected();
    this.ptrEvent(0, x, y);
    await sleep(15);
    this.ptrEvent(mask, x, y);
    await sleep(holdMs);
    this.ptrEvent(0, x, y);
    await sleep(60);
  }

  private async keyDownUp(keysym: number, down: boolean) {
    const k = Buffer.alloc(8);
    k[0] = 4; k[1] = down ? 1 : 0;
    k.writeUInt32BE(keysym, 4);
    this.send(k);
    await sleep(8);
  }

  private async pressKeysym(keysym: number, holdMs = 30) {
    await this.keyDownUp(keysym, true);
    await sleep(holdMs);
    await this.keyDownUp(keysym, false);
  }

  private async pressCombo(keyName: string) {
    const parts = keyName.split('+').map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length === 0) return;
    if (parts.length === 1) {
      const t = parts[0];
     if (t.length === 1 && t >= 'A' && t <= 'Z') {
        await this.pressKeysym(t.charCodeAt(0));
      } else {
        await this.pressKeysym(keysymFor(t));
      }
      return;
    }
    const mods = parts.slice(0, -1).map((m) => keysymFor(m));
   const main = parts[parts.length - 1];
   for (const m of mods) await this.keyDownUp(m, true);
    await sleep(45);
   if (main.length === 1 && main >= 'A' && main <= 'Z') {
     await this.pressKeysym(main.charCodeAt(0));
    } else {
      await this.pressKeysym(keysymFor(main));
   }
    await sleep(20);
   for (const m of mods.slice().reverse()) await this.keyDownUp(m, false);
  }

  // ---------- internals ----------

  private assertConnected() {
    if (this.destroyed || !this.ws || this._w === 0) throw new Error('vnc device not connected');
  }

  private send(b: Buffer) {
    if (this.destroyed) throw new Error('vnc device destroyed');
    this.ws.send(b);
  }

  private take(n: number): Promise<Buffer> {
    if (this.buf.length >= n) return Promise.resolve(this.takeSync(n));
    return new Promise((resolve) => {
      this.waiters.push({ n, resolve: () => resolve(this.takeSync(n)) });
    });
  }

  private takeSync(n: number): Buffer {
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  private pumpWaiters() {
    while (this.waiters.length && this.buf.length >= this.waiters[0].n) {
      const w = this.waiters.shift()!;
      w.resolve();
    }
  }

  private async pumpServerMessages() {
    if (this.parsing) return;
    this.parsing = true;
    try {
      for (;;) {
        if (this.buf.length < 4) return;
        const type = this.buf[0];
        if (type === 0) {
          const nRects = this.buf.readUInt16BE(2);
          const done = this.tryParseUpdate(nRects);
          if (!done) return;
        } else if (type === 1) {
          if (this.buf.length < 8) return;
          // SetColourMapEntries: type(1) + padding(1) + first-color(2) +
          // number-of-colors(2), then n * 6 bytes of RGB triplets.
          const n = this.buf.readUInt16BE(4);
          const need = 8 + n * 6;
          if (this.buf.length < need) return;
          this.takeSync(need);
        } else if (type === 2) {
          this.takeSync(1); // Bell
        } else if (type === 3) {
          if (this.buf.length < 8) return;
          const len = this.buf.readInt32BE(4);
          if (this.buf.length < 8 + Math.abs(len)) return;
          this.takeSync(8);
          this.handleServerCutText(len);
        } else {
          console.warn('[vnc] unknown server message type ' + type);
          await this.destroy();
          return;
        }
      }
    } finally {
      this.parsing = false;
    }
  }

  private tryParseUpdate(nRects: number): boolean {
    let pos = 4;
    const stride = this._w * 4;
    for (let i = 0; i < nRects; i++) {
      if (this.buf.length < pos + 12) return false;
      const x = this.buf.readUInt16BE(pos);
      const y = this.buf.readUInt16BE(pos + 2);
      const w = this.buf.readUInt16BE(pos + 4);
      const h = this.buf.readUInt16BE(pos + 6);
      const enc = this.buf.readInt32BE(pos + 8);
      pos += 12;
      if (enc === 0) {
        const need = w * h * 4;
        if (this.buf.length < pos + need) return false;
        const src = this.buf.subarray(pos, pos + need);
        pos += need;
        for (let row = 0; row < h; row++) {
          const dy = y + row;
          if (dy >= this._h) break;
          const cw = Math.min(w, this._w - x);
          src.copy(Buffer.from(this.fb.buffer), dy * stride + x * 4, row * w * 4, row * w * 4 + cw * 4);
        }
        this.creditRect(w, h);
      } else if (enc === 5) {
        if (this.buf.length < pos + 4) return false;
        const sx = this.buf.readUInt16BE(pos);
        const sy = this.buf.readUInt16BE(pos + 2);
        pos += 4;
        const fb = Buffer.from(this.fb.buffer);
        for (let row = 0; row < h; row++) {
          const dy = y + row;
          if (dy >= this._h) break;
          const cw = Math.min(w, this._w - x);
          fb.copyWithin(dy * stride + x * 4, (sy + row) * stride + sx * 4, (sy + row) * stride + sx * 4 + cw * 4);
        }
        this.creditRect(w, h);
      } else if (enc === -307) {
        this._w = w; this._h = h;
        this.fb = new Uint8Array(w * h * 4);
        if (this.shotWait) this.shotWait.remaining = w * h;
      } else {
        console.warn('[vnc] unsupported encoding ' + enc);
        return false;
      }
    }
    this.takeSync(pos);
    return true;
  }

  private creditRect(w: number, h: number) {
    const s = this.shotWait;
    if (!s) return;
    s.remaining -= w * h;
    if (s.remaining <= 0) {
      clearTimeout(s.timer);
      this.shotWait = null;
      s.resolve();
    }
  }
}

export async function agentForVNC(opts: { wsUrl: string } & Record<string, any>): Promise<any> {
  const device = new VNCDevice({ wsUrl: opts.wsUrl });
  await device.connect();
  return new ComputerAgent(device as any, opts as any);
}
