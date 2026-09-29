// RDP-to-VNC backend adapter.
//
// @midscene/computer already defines the exact native boundary we need:
// RDPBackendClient. Instead of implementing (and repeatedly debugging) an RDP
// server proxy, this module keeps RDPDevice and replaces only its backend with
// VNCDevice. Every RDP operation therefore preserves Midscene's semantics while
// the wire protocol becomes RFB over noVNC/websockify.
import { ComputerAgent, RDPDevice } from '@midscene/computer';
import { VNCDevice } from './vnc.device.js';

const RDP_TO_VNC_PORT: Record<number, number> = {
  3389: 8006,   // legacy win11-en layout
  3390: 8007,   // legacy win11-wx layout
  13389: 18006, // current fixed-entry family
  14389: 19006, // current parallel test family
};

export function vncUrlFromRDPConfig(config: {
  host?: string;
  port?: number;
  vncUrl?: string;
  vncPort?: number;
}): string {
  if (config.vncUrl) return config.vncUrl;
  const host = config.host || '127.0.0.1';
  const rdpPort = config.port || 3389;
  const vncPort = config.vncPort || RDP_TO_VNC_PORT[rdpPort];
  if (!vncPort) {
    throw new Error(
      'No VNC mapping for RDP port ' + rdpPort + '. Pass vncUrl or vncPort explicitly. Known mappings: ' +
      Object.entries(RDP_TO_VNC_PORT).map(([r, v]) => r + '->' + v).join(', '),
    );
  }
  return 'ws://' + host + ':' + vncPort + '/websockify';
}

export class VNCRDPBackendClient {
  private device?: VNCDevice;
  private sessionId = 'vnc-' + Math.random().toString(36).slice(2, 10);

  constructor(private config: { host?: string; port?: number; vncUrl?: string; vncPort?: number }) {}

  async connect(config: any = {}) {
    const merged = { ...this.config, ...config };
    const wsUrl = vncUrlFromRDPConfig(merged);
    const device = new VNCDevice({ wsUrl });
    await device.connect();
    this.device = device;
    const size = await device.size();
    if ((merged.desktopWidth && merged.desktopWidth !== size.width) || (merged.desktopHeight && merged.desktopHeight !== size.height)) {
      await device.destroy();
      throw new Error('VNC framebuffer is ' + size.width + 'x' + size.height + ', RDP config requested ' + merged.desktopWidth + 'x' + merged.desktopHeight);
    }
    return { sessionId: this.sessionId, size, server: wsUrl };
  }

  async disconnect() { await this.device?.destroy(); this.device = undefined; }
  async screenshotBase64() { this.assert(); return await this.device!.screenshotBase64(); }
  async size() { this.assert(); return await this.device!.size(); }
  async mouseMove(x: number, y: number) { this.assert(); await this.device!.rdpMouseMove(x, y); }
  async mouseButton(button: any, action: any) { this.assert(); await this.device!.rdpMouseButton(button, action); }
  async wheel(direction: any, amount: number, x?: number, y?: number) { this.assert(); await this.device!.rdpWheel(direction, amount, x, y); }
  async keyPress(keyName: string) { this.assert(); await this.device!.rdpKeyPress(keyName); }
  async typeText(text: string) { this.assert(); await this.device!.rdpTypeText(text); }
  async clearInput() { this.assert(); await this.device!.rdpClearInput(); }

  get vncDevice(): VNCDevice { this.assert(); return this.device!; }
  private assert() { if (!this.device) throw new Error('VNC RDP backend is not connected'); }
}

export async function agentForRDPOverVNC(opts: Record<string, any>): Promise<any> {
  const backend = new VNCRDPBackendClient(opts);
  // @midscene/computer's RDPDevice still normalizes an RDP host even though this
  // backend never opens port 3389. Give callers the same default as the mapping.
  const device = new RDPDevice({ ...opts, host: opts.host || '127.0.0.1', backend } as any);
  await device.connect();
  return new ComputerAgent(device as any, opts);
}

// Explicit operation-protocol translator for callers that do not want an Agent.
// The request union intentionally mirrors @midscene/computer's RDPProtocolRequest.
export async function applyRDPRequest(backend: VNCRDPBackendClient, req: any): Promise<any> {
  switch (req.type) {
    case 'connect': return { type: 'connected', info: await backend.connect(req.config) };
    case 'disconnect': await backend.disconnect(); return { type: 'ok' };
    case 'screenshot': return { type: 'screenshot', base64: (await backend.screenshotBase64()).replace(/^data:image\/png;base64,/, '') };
    case 'size': return { type: 'size', size: await backend.size() };
    case 'mouseMove': await backend.mouseMove(req.x, req.y); return { type: 'ok' };
    case 'mouseButton': await backend.mouseButton(req.button, req.action); return { type: 'ok' };
    case 'wheel': await backend.wheel(req.direction, req.amount, req.x, req.y); return { type: 'ok' };
    case 'keyPress': await backend.keyPress(req.keyName); return { type: 'ok' };
    case 'typeText': await backend.typeText(req.text); return { type: 'ok' };
    case 'clearInput': await backend.clearInput(); return { type: 'ok' };
    default: throw new Error('unsupported RDP protocol request: ' + req.type);
  }
}
