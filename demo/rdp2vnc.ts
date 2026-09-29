// Deterministic RDP-protocol-over-VNC test for one target. No model calls.
//
// Stage 1 exercises VNCRDPBackendClient directly through applyRDPRequest().
// Stage 2 plugs that backend into @midscene/computer's own RDPDevice and uses
// its inputPrimitives. Both stages speak RFB only; no TCP connection to 3389
// is made.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RDPDevice } from '@midscene/computer';
import { VNCRDPBackendClient, applyRDPRequest, vncUrlFromRDPConfig } from '../src/rdp.vnc.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const demoDir = path.dirname(fileURLToPath(import.meta.url));

function args() {
  const name = process.argv[2] || 'target';
  const port = Number(process.argv[3] || 3389);
  const outDir = process.argv[4] || path.join(demoDir, 'out');
  return { name, port, outDir };
}

async function saveDataUrl(dataUrl: string, file: string) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

async function meanAbsDiff(a: Buffer, b: Buffer) {
  const x = await sharp(a).raw().toBuffer({ resolveWithObject: true });
  const y = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  if (x.info.width !== y.info.width || x.info.height !== y.info.height || x.data.length !== y.data.length) {
    throw new Error('frame geometry changed');
  }
  let total = 0;
  for (let i = 0; i < x.data.length; i++) total += Math.abs(x.data[i] - y.data[i]);
  return total / x.data.length;
}

(async () => {
  const { name, port, outDir } = args();
  const started = Date.now();
  const base = { host: '127.0.0.1', port };
  const wsUrl = vncUrlFromRDPConfig(base);
  console.log('TARGET=' + name + ' RDP_PORT=' + port + ' TRANSPORT=' + wsUrl);

  // Stage 1: explicit operation protocol translator.
  const backend = new VNCRDPBackendClient(base);
  const connected: any = await applyRDPRequest(backend, { type: 'connect', config: base });
  console.log('PROTOCOL_CONNECTED=' + JSON.stringify(connected.info));
  const sizeResp: any = await applyRDPRequest(backend, { type: 'size' });
  if (sizeResp.size.width !== 1280 || sizeResp.size.height !== 800) throw new Error('unexpected size ' + JSON.stringify(sizeResp.size));
  await applyRDPRequest(backend, { type: 'mouseMove', x: 640, y: 400 });
  await applyRDPRequest(backend, { type: 'mouseButton', button: 'left', action: 'click' });
  await applyRDPRequest(backend, { type: 'wheel', direction: 'down', amount: 120, x: 640, y: 400 });
  await applyRDPRequest(backend, { type: 'wheel', direction: 'up', amount: 120, x: 640, y: 400 });
  await applyRDPRequest(backend, { type: 'keyPress', keyName: 'Escape' });
  const shot1: any = await applyRDPRequest(backend, { type: 'screenshot' });
  const protocolPng = await saveDataUrl('data:image/png;base64,' + shot1.base64, path.join(outDir, 'rdp2vnc_' + name + '_protocol.png'));
  await applyRDPRequest(backend, { type: 'disconnect' });
  console.log('PROTOCOL_OK png_bytes=' + protocolPng.length);

  // Stage 2: official RDPDevice, native backend replaced by VNC.
  const deviceBackend = new VNCRDPBackendClient(base);
  const device: any = new RDPDevice({ ...base, backend: deviceBackend } as any);
  await device.connect();
  const devSize = await device.size();
  console.log('RDP_DEVICE_SIZE=' + devSize.width + 'x' + devSize.height);

  await device.inputPrimitives.pointer.hover({ x: 640, y: 400 });
  await device.inputPrimitives.pointer.tap({ x: 640, y: 400 });
  await device.inputPrimitives.keyboard.keyboardPress('Escape');
  await sleep(500);
  const beforeStart = await saveDataUrl(await device.screenshotBase64(), path.join(outDir, 'rdp2vnc_' + name + '_before_start.png'));

  // Pointer-effect gate: click the taskbar Start pin and require a visible
  // menu. Keyboard Win+r elsewhere proves keysyms, not PointerEvent delivery.
  await device.inputPrimitives.pointer.tap({ x: 28, y: 773 });
  await sleep(1600);
  const startMenu = await saveDataUrl(await device.screenshotBase64(), path.join(outDir, 'rdp2vnc_' + name + '_start_menu.png'));
  const pointerDiff = await meanAbsDiff(beforeStart, startMenu);
  console.log('POINTER_DIFF_START_MENU=' + pointerDiff.toFixed(4));
  const pointerVisible = pointerDiff >= 0.1;
  console.log('POINTER_VISIBLE=' + pointerVisible);
  // QEMU's active mouse handler decides whether RFB PointerEvent reaches the guest.
  // Require it explicitly on a known-good target; otherwise report the honest result.
  if (process.env.REQUIRE_POINTER === '1' && !pointerVisible) {
    throw new Error('PointerEvent produced no visible Start menu');
  }
  await device.inputPrimitives.keyboard.keyboardPress('Escape');
  await sleep(800);
  const beforeBuf = await saveDataUrl(await device.screenshotBase64(), path.join(outDir, 'rdp2vnc_' + name + '_before_run.png'));

  await device.inputPrimitives.keyboard.keyboardPress('Win+r');
  await sleep(1400);
  const runBuf = await saveDataUrl(await device.screenshotBase64(), path.join(outDir, 'rdp2vnc_' + name + '_run_dialog.png'));

  // Uppercase Z exercises the Shift fix; mixed symbols exercise keysym mapping.
  await device.inputPrimitives.keyboard.typeText('Rdp2Vnc ZHEN 42', { replace: false });
  await sleep(900);
  const typedBuf = await saveDataUrl(await device.screenshotBase64(), path.join(outDir, 'rdp2vnc_' + name + '_typed.png'));

  await device.inputPrimitives.keyboard.keyboardPress('Escape');
  await sleep(700);
  await device.destroy();

  const diffRunTyped = await meanAbsDiff(runBuf, typedBuf);
  const diffBeforeTyped = await meanAbsDiff(beforeBuf, typedBuf);
  console.log('FRAME_DIFF_RUN_TO_TYPED=' + diffRunTyped.toFixed(4));
  console.log('FRAME_DIFF_BEFORE_TO_TYPED=' + diffBeforeTyped.toFixed(4));
  if (diffRunTyped < 0.05) throw new Error('typed frame did not change; keyboard/typeText translation likely failed');

  const result = {
    target: name, rdpPort: port, transport: wsUrl, size: sizeResp.size,
    protocolPngBytes: protocolPng.length, diffRunTyped, diffBeforeTyped,
    pointerDiff,
    pointerVisible,
    elapsedMs: Date.now() - started, ok: true,
  };
  fs.writeFileSync(path.join(outDir, 'rdp2vnc_' + name + '.json'), JSON.stringify(result, null, 2));
  console.log('RESULT=' + JSON.stringify(result));
})().catch((e) => {
  console.error('FAILED target=' + (process.argv[2] || 'target') + ' error=' + ((e && e.stack) || e));
  process.exitCode = 1;
});
